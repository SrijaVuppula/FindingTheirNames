// ===================================================
//                 CONFIGURATION
// ===================================================
const EVENT_TABLE_NAME  = 'Event Table'; 
const PERSON_TABLE_NAME = 'Person Table';
const PART_TABLE_NAME   = 'Age Junction Table';

const LINK_FIELD_IN_PERSON = 'Events'; 
const LINK_FIELD_IN_EVENT  = 'People'; 

const PART_EVENT_COL  = 'Event Table';
const PART_PERSON_COL = 'Person Table';

// ===================================================
//                 MAIN LOGIC
// ===================================================
const { sourceTableName, recordId } = input.config();

if (!sourceTableName || !recordId) {
    throw new Error("Missing input variables! Check the left sidebar settings.");
}

const eventTable  = base.getTable(EVENT_TABLE_NAME);
const personTable = base.getTable(PERSON_TABLE_NAME);
const partTable   = base.getTable(PART_TABLE_NAME);

// Helper functions for safely creating/deleting in bulk
async function batchCreate(table, payloads) {
    while (payloads.length > 0) await table.createRecordsAsync(payloads.splice(0, 50));
}
async function batchDelete(table, recordIds) {
    while (recordIds.length > 0) await table.deleteRecordsAsync(recordIds.splice(0, 50));
}

// ---------------------------------------------------
// SCENARIO 1: Triggered from the EVENT Table
// ---------------------------------------------------
if (sourceTableName === EVENT_TABLE_NAME) {
    const eventRec = await eventTable.selectRecordAsync(recordId);
    if (!eventRec) return;

    const linkedPeopleIds = (eventRec.getCellValue(LINK_FIELD_IN_EVENT) || []).map(p => p.id);

    // Fetch the junction table and use pure JavaScript to find matches (100% immune to lag)
    const query = await partTable.selectRecordsAsync({
        fields: [PART_EVENT_COL, PART_PERSON_COL]
    });

    // Find only the junction rows that belong to THIS exact event
    const relevantJunctions = query.records.filter(r => {
        const links = r.getCellValue(PART_EVENT_COL);
        return links && links.some(l => l.id === recordId);
    });

    const existingPersonIds = [];
    const junctionsToDelete = [];

    // Sort existing junctions: Keep it or Trash it?
    relevantJunctions.forEach(j => {
        const personLinks = j.getCellValue(PART_PERSON_COL);
        const pId = (personLinks && personLinks.length > 0) ? personLinks[0].id : null;
        
        if (pId && linkedPeopleIds.includes(pId)) {
            existingPersonIds.push(pId); // Still linked, keep it
        } else {
            junctionsToDelete.push(j.id); // Unlinked, trash it
        }
    });

    // Identify the missing connections to create
    const toCreate = linkedPeopleIds
        .filter(pid => !existingPersonIds.includes(pid))
        .map(pid => ({
            fields: {
                [PART_EVENT_COL]: [{ id: recordId }],
                [PART_PERSON_COL]: [{ id: pid }]
            }
        }));

    // Execute the Sync
    if (junctionsToDelete.length > 0) {
        console.log(`Deleting ${junctionsToDelete.length} removed connections.`);
        await batchDelete(partTable, junctionsToDelete);
    }
    if (toCreate.length > 0) {
        console.log(`Creating ${toCreate.length} new connections.`);
        await batchCreate(partTable, toCreate);
    }
    if (toCreate.length === 0 && junctionsToDelete.length === 0) {
        console.log("Everything is already perfectly synced!");
    }
} 

// ---------------------------------------------------
// SCENARIO 2: Triggered from the PERSON Table
// (Included just in case you ever switch your master trigger)
// ---------------------------------------------------
else if (sourceTableName === PERSON_TABLE_NAME) {
    const personRec = await personTable.selectRecordAsync(recordId);
    if (!personRec) return;

    const linkedEventIds = (personRec.getCellValue(LINK_FIELD_IN_PERSON) || []).map(e => e.id);

    const query = await partTable.selectRecordsAsync({
        fields: [PART_EVENT_COL, PART_PERSON_COL]
    });

    const relevantJunctions = query.records.filter(r => {
        const links = r.getCellValue(PART_PERSON_COL);
        return links && links.some(l => l.id === recordId);
    });

    const existingEventIds = [];
    const junctionsToDelete = [];

    relevantJunctions.forEach(j => {
        const eventLinks = j.getCellValue(PART_EVENT_COL);
        const eId = (eventLinks && eventLinks.length > 0) ? eventLinks[0].id : null;
        
        if (eId && linkedEventIds.includes(eId)) {
            existingEventIds.push(eId); 
        } else {
            junctionsToDelete.push(j.id); 
        }
    });

    const toCreate = linkedEventIds
        .filter(eid => !existingEventIds.includes(eid))
        .map(eid => ({
            fields: {
                [PART_EVENT_COL]: [{ id: eid }],
                [PART_PERSON_COL]: [{ id: recordId }]
            }
        }));

    if (junctionsToDelete.length > 0) {
        console.log(`Deleting ${junctionsToDelete.length} removed connections.`);
        await batchDelete(partTable, junctionsToDelete);
    }
    if (toCreate.length > 0) {
        console.log(`Creating ${toCreate.length} new connections.`);
        await batchCreate(partTable, toCreate);
    }
    if (toCreate.length === 0 && junctionsToDelete.length === 0) {
        console.log("Everything is already perfectly synced!");
    }
}
