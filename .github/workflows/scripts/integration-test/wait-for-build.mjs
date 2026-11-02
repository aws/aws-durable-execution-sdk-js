// Waits for the `build` job of this workflow run to finish, so the integration job can
// do its setup (runner start, Node, credentials, SAM, npm ci) while build is still running
// and only needs the build artifacts when it deploys.
//
// Exits 0 when `build` succeeded (it uploads `built-artifacts` as its last step), and 1
// when `build` failed, was cancelled, or did not finish in time.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = process.env;
const POLL_MS = 3000;
const TIMEOUT_MS = 15 * 60 * 1000;
const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100`;

const started = Date.now();
let lastStatus = '';
while (Date.now() - started < TIMEOUT_MS) {
  let job;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      job = (await res.json()).jobs.find((j) => j.name === 'build');
    } else {
      console.log(`Jobs API returned ${res.status}, retrying`);
    }
  } catch (err) {
    console.log(`Jobs API call failed (${err.message}), retrying`);
  }
  const status = job ? `${job.status}/${job.conclusion ?? '-'}` : 'not found';
  if (status !== lastStatus) {
    console.log(`build job: ${status} (${Math.round((Date.now() - started) / 1000)}s)`);
    lastStatus = status;
  }
  if (job?.status === 'completed') {
    if (job.conclusion === 'success') process.exit(0);
    console.error(`build job ended with ${job.conclusion}; not deploying`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
console.error('Timed out waiting for the build job');
process.exit(1);
