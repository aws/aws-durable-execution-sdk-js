const fs = require('fs');
const path = require('path');

const handlerFile = process.argv[2];
const historyFile = process.argv[3];

if (!handlerFile || !historyFile) {
    console.error('Usage: node assert-history.js <handler-file> <history-file>');
    process.exit(1);
}

const fileName = handlerFile.replace('.handler', '');
const expectedHistoryPath = path.join('src/__histories__', `${fileName}.json`);

if (!fs.existsSync(expectedHistoryPath)) {
    console.log(`No expected history file found at ${expectedHistoryPath}, skipping assertion`);
    process.exit(0);
}

if (!fs.existsSync(historyFile)) {
    console.error(`History file not found: ${historyFile}`);
    process.exit(1);
}

console.log(`Asserting history for ${fileName}...`);

const actual = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
const expected = JSON.parse(fs.readFileSync(expectedHistoryPath, 'utf8'));

console.log('Actual history:', JSON.stringify(actual, null, 2));
console.log('Expected history:', JSON.stringify(expected, null, 2));

const actualEvents = actual.Events || [];
const expectedEvents = expected.expectedHistory?.events || [];

if (actualEvents.length !== expectedEvents.length) {
    console.error(`Event count mismatch: expected ${expectedEvents.length}, got ${actualEvents.length}`);
    process.exit(1);
}

for (let i = 0; i < expectedEvents.length; i++) {
    const actualEvent = actualEvents[i];
    const expectedEvent = expectedEvents[i];
    
    if (actualEvent.EventType !== expectedEvent.EventType) {
        console.error(`Event ${i+1} type mismatch: expected ${expectedEvent.EventType}, got ${actualEvent.EventType}`);
        process.exit(1);
    }
}

console.log('History assertion passed');
