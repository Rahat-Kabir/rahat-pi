// Runs before every npm entry point. Plain JavaScript with no imports, so it still
// works on an old Node that would otherwise fail on `node:sqlite` with an unclear error.
const requiredVersion = [22, 19, 0];
const installedVersion = process.versions.node.split('.').map(Number);

const isOldNode = requiredVersion.some((requiredPart, index) => {
  const previousPartsEqual = requiredVersion
    .slice(0, index)
    .every((previousPart, previousIndex) => installedVersion[previousIndex] === previousPart);
  return previousPartsEqual && installedVersion[index] < requiredPart;
});

if (isOldNode) {
  console.error(
    `Rahat-PI needs Node ${requiredVersion.join('.')} or newer (for node:sqlite); you have ${process.versions.node}.\n`
      + 'Install Node 22 LTS or newer from https://nodejs.org, then run the command again.',
  );
  process.exit(1);
}
