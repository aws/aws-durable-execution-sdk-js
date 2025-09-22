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

// Create event signature for comparison (ignoring order-sensitive fields)
function createEventSignature(event) {
    const signature = {
        EventType: event.EventType,
        SubType: event.SubType
    };
    
    // Only include Name for events that have stable names (not ExecutionStarted/ExecutionSucceeded)
    if (event.EventType !== 'ExecutionStarted' && event.EventType !== 'ExecutionSucceeded' && event.Name) {
        signature.Name = event.Name;
    }
    
    return signature;
}

// Count occurrences of each event signature
function countEventSignatures(events) {
    const counts = new Map();
    events.forEach(event => {
        const signature = JSON.stringify(createEventSignature(event));
        counts.set(signature, (counts.get(signature) || 0) + 1);
    });
    return counts;
}

const actualCounts = countEventSignatures(actualEvents);
const expectedCounts = countEventSignatures(expectedEvents);

// Check that all expected events exist with correct counts
for (const [signature, expectedCount] of expectedCounts) {
    const actualCount = actualCounts.get(signature) || 0;
    if (actualCount !== expectedCount) {
        const eventInfo = JSON.parse(signature);
        console.error(`Event signature mismatch for ${eventInfo.EventType}${eventInfo.SubType ? `(${eventInfo.SubType})` : ''}${eventInfo.Name ? ` "${eventInfo.Name}"` : ''}: expected ${expectedCount}, got ${actualCount}`);
        process.exit(1);
    }
}

// Check that no unexpected events exist
for (const [signature, actualCount] of actualCounts) {
    if (!expectedCounts.has(signature)) {
        const eventInfo = JSON.parse(signature);
        console.error(`Unexpected event: ${eventInfo.EventType}${eventInfo.SubType ? `(${eventInfo.SubType})` : ''}${eventInfo.Name ? ` "${eventInfo.Name}"` : ''} (${actualCount} occurrences)`);
        process.exit(1);
    }
}

console.log('History assertion passed');
