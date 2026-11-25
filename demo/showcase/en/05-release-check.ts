/** A small, explicit release check for a fictional product team. */
type Release = {
  version: string;
  checksPassed: boolean;
  rollbackReady: boolean;
};

/** Return the checks still needed before a release can proceed. */
export function reviewRelease(release: Release): string[] {
  const remaining: string[] = [];

  if (!release.checksPassed) {
    remaining.push("Run the required checks");
  }

  if (!release.rollbackReady) {
    remaining.push("Prepare a rollback plan");
  }

  return remaining;
}

const release: Release = {
  version: "2.4.0",
  checksPassed: true,
  rollbackReady: true,
};

console.log(reviewRelease(release));
