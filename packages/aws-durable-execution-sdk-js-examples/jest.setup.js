// Jest setup for the local example tests.
//
// CI runners on Lambda/CodeBuild compute inject `_X_AMZN_TRACE_ID`. The
// Powertools Logger picks it up and adds an `xray_trace_id` field to every
// log line, which breaks the log-output snapshots of the local logger
// examples. Clear it before any test module loads so the suite does not
// depend on the host environment.
delete process.env._X_AMZN_TRACE_ID;
