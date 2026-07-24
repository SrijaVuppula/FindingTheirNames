// ======================
// CONFIG
// ======================
const EVENT_TABLE  = 'Event Table';
const SOURCE_TABLE = 'Source Table';
const PLACE_TABLE  = 'Place Table';
const PERSON_TABLE = 'Person Table';

// Event fields
const EVENT_SOURCE_LINK_FIELD = 'Source Associator'; // Event -> Source
const EVENT_PLACE_LINK_FIELD  = 'Place Associator';  // Event -> Place
const EVENT_PEOPLE_LINK_FIELD = 'People';            // Event -> People

// Source fields
const SOURCE_EVENT_LINK_FIELD = 'Event Associator';        // Source -> Event
const SOURCE_PLACE_LINK_FIELD = 'Place Associator';        // Source -> Place 
const SOURCE_PEOPLE_LINK_FIELD = 'Person Associator';      // Source -> People 

// Place field
const PLACE_SOURCE_LINK_FIELD = 'Source Associator'; // Place -> Source (derived)

// Person fields
const PERSON_EVENT_LINK_FIELD  = 'Events';                  // Person -> Event
const PERSON_SOURCE_LINK_FIELD = 'Source Associator';       // Person -> Source (derived)

// Toggle: also keep Source<->People derived links
const UPDATE_SOURCE_PEOPLE = true;

// ======================
// INPUTS
// ======================
const { recordId } = input.config();
if (!recordId) throw new Error("Missing recordId input. Add it in the automation script settings.");

// ======================
// TABLES
// ======================
const eventTable  = base.getTable(EVENT_TABLE);
const sourceTable = base.getTable(SOURCE_TABLE);
const placeTable  = base.getTable(PLACE_TABLE);
const personTable = base.getTable(PERSON_TABLE);

// ======================
// HELPERS
// ======================
const uniq = (arr) => [...new Set(arr)];
const toIds = (links) => (links || []).map(x => x.id);

async function batchUpdate(table, updates) {
  while (updates.length) await table.updateRecordsAsync(updates.splice(0, 50));
}

// ======================
// LOAD TRIGGER EVENT
// ======================
const eventRec = await eventTable.selectRecordAsync(recordId, {
  fields: [EVENT_SOURCE_LINK_FIELD, EVENT_PLACE_LINK_FIELD, EVENT_PEOPLE_LINK_FIELD],
});
if (!eventRec) return;

// ======================
// LOAD TABLES (minimal fields)
// ======================
const allEvents = await eventTable.selectRecordsAsync({
  fields: [EVENT_SOURCE_LINK_FIELD, EVENT_PLACE_LINK_FIELD, EVENT_PEOPLE_LINK_FIELD],
});

const allSources = await sourceTable.selectRecordsAsync({
  fields: [SOURCE_EVENT_LINK_FIELD, SOURCE_PLACE_LINK_FIELD].concat(UPDATE_SOURCE_PEOPLE ? [SOURCE_PEOPLE_LINK_FIELD] : []),
});

const allPlaces = await placeTable.selectRecordsAsync({
  fields: [PLACE_SOURCE_LINK_FIELD],
});

const allPeople = await personTable.selectRecordsAsync({
  fields: [PERSON_EVENT_LINK_FIELD, PERSON_SOURCE_LINK_FIELD],
});

// Maps for fast lookup
const sourceById = new Map(allSources.records.map(r => [r.id, r]));
const placeById  = new Map(allPlaces.records.map(r => [r.id, r]));
const eventById   = new Map(allEvents.records.map(r => [r.id, r]));
const personById  = new Map(allPeople.records.map(r => [r.id, r]));

// ===================================================
// PART A: SOURCE <-> PLACE via EVENTS
// ===================================================

// Sources currently linked to this event
const sourcesNow = toIds(eventRec.getCellValue(EVENT_SOURCE_LINK_FIELD));

// Sources previously linked (covers cleanup when source is removed from the event)
const sourcesPreviously = allSources.records
  .filter(s => toIds(s.getCellValue(SOURCE_EVENT_LINK_FIELD)).includes(recordId))
  .map(s => s.id);

const impactedSourceIds = uniq([...sourcesNow, ...sourcesPreviously]);

const sourceUpdates = [];
const impactedPlaceIds = new Set();

for (const sId of impactedSourceIds) {
  const sRec = sourceById.get(sId);
  if (!sRec) continue;

  const eventIdsForSource = toIds(sRec.getCellValue(SOURCE_EVENT_LINK_FIELD));

  // UNION of places across all events linked to this source
  const computedPlaceIds = [];
  for (const eId of eventIdsForSource) {
    const eRec = eventById.get(eId);
    if (!eRec) continue;
    computedPlaceIds.push(...toIds(eRec.getCellValue(EVENT_PLACE_LINK_FIELD)));
  }
  const newPlaceIds = uniq(computedPlaceIds);

  // Track old + new places so we can recompute Place->Source
  const oldPlaceIds = toIds(sRec.getCellValue(SOURCE_PLACE_LINK_FIELD));
  oldPlaceIds.forEach(pid => impactedPlaceIds.add(pid));
  newPlaceIds.forEach(pid => impactedPlaceIds.add(pid));

  sourceUpdates.push({
    id: sId,
    fields: {
      [SOURCE_PLACE_LINK_FIELD]: newPlaceIds.map(id => ({ id })),
    },
  });
}

if (sourceUpdates.length) await batchUpdate(sourceTable, sourceUpdates);

// Recompute Place -> Source for impacted places
const placeUpdates = [];

for (const pId of impactedPlaceIds) {
  const pRec = placeById.get(pId);
  if (!pRec) continue;

  const sourcesForPlace = new Set();

  for (const eRec of allEvents.records) {
    const placeIdsInEvent = toIds(eRec.getCellValue(EVENT_PLACE_LINK_FIELD));
    if (!placeIdsInEvent.includes(pId)) continue;

    const srcIdsInEvent = toIds(eRec.getCellValue(EVENT_SOURCE_LINK_FIELD));
    srcIdsInEvent.forEach(sid => sourcesForPlace.add(sid));
  }

  placeUpdates.push({
    id: pId,
    fields: {
      [PLACE_SOURCE_LINK_FIELD]: [...sourcesForPlace].map(id => ({ id })),
    },
  });
}

if (placeUpdates.length) await batchUpdate(placeTable, placeUpdates);

// ===================================================
// PART B: PERSON <-> SOURCE via EVENTS
// ===================================================

// People currently linked to this event
const peopleNow = toIds(eventRec.getCellValue(EVENT_PEOPLE_LINK_FIELD));

// People previously linked (covers cleanup when person removed from the event)
const peoplePreviously = allPeople.records
  .filter(p => toIds(p.getCellValue(PERSON_EVENT_LINK_FIELD)).includes(recordId))
  .map(p => p.id);

const impactedPersonIds = uniq([...peopleNow, ...peoplePreviously]);

// Update each impacted Person: Sources = UNION of sources across all their events
const personUpdates = [];

for (const pid of impactedPersonIds) {
  const pRec = personById.get(pid);
  if (!pRec) continue;

  const eventIdsForPerson = toIds(pRec.getCellValue(PERSON_EVENT_LINK_FIELD));

  const computedSourceIds = [];
  for (const eId of eventIdsForPerson) {
    const eRec = eventById.get(eId);
    if (!eRec) continue;
    computedSourceIds.push(...toIds(eRec.getCellValue(EVENT_SOURCE_LINK_FIELD)));
  }

  const newSourceIds = uniq(computedSourceIds);

  personUpdates.push({
    id: pid,
    fields: {
      [PERSON_SOURCE_LINK_FIELD]: newSourceIds.map(id => ({ id })),
    },
  });
}

if (personUpdates.length) await batchUpdate(personTable, personUpdates);

// OPTIONAL: Update Source -> People (derived) too
if (UPDATE_SOURCE_PEOPLE) {
  const sourcePeopleUpdates = [];

  for (const sId of impactedSourceIds) {
    const sRec = sourceById.get(sId);
    if (!sRec) continue;

    const eventIdsForSource = toIds(sRec.getCellValue(SOURCE_EVENT_LINK_FIELD));

    const computedPeopleIds = [];
    for (const eId of eventIdsForSource) {
      const eRec = eventById.get(eId);
      if (!eRec) continue;
      computedPeopleIds.push(...toIds(eRec.getCellValue(EVENT_PEOPLE_LINK_FIELD)));
    }

    const newPeopleIds = uniq(computedPeopleIds);

    sourcePeopleUpdates.push({
      id: sId,
      fields: {
        [SOURCE_PEOPLE_LINK_FIELD]: newPeopleIds.map(id => ({ id })),
      },
    });
  }

  if (sourcePeopleUpdates.length) await batchUpdate(sourceTable, sourcePeopleUpdates);
}

console.log("Source<->Place and Person<->Source via Event links.");
