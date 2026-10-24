import { runEvaluations, formatEvalResults } from '../src/evals/runner.js';

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.some(argument => argument !== '--live')) {
    throw new Error('Usage: npm run eval -- [--live]');
  }
  const live = argumentsList.includes('--live') || process.env.RAHAT_PI_LIVE_EVAL === '1';
  const { report, reportPath } = await runEvaluations({ live });
  console.log(formatEvalResults(report.results));
  console.log(`${report.passed} passed, ${report.failed} failed; ${report.mode}; report: ${reportPath}`);
  if (report.failed > 0) {
    process.exitCode = 1;
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
