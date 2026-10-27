// Jest setup for the OTel plugin unit tests.
//
// The X-Ray context extractor falls back to the ambient `_X_AMZN_TRACE_ID`
// environment variable. CI runners on Lambda/CodeBuild compute inject it,
// which anchors the default-provider plugins on that trace (usually with
// `Sampled=0`) and drops every span, breaking hermetic tests that expect a
// fresh Workflow/Invocation trace. Clear it before any test module loads so
// the suite does not depend on the host environment. Tests that exercise the
// variable set and restore it themselves.
delete process.env._X_AMZN_TRACE_ID;
