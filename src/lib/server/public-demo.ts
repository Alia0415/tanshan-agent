/** Read at request time so one Docker image supports both deployment modes. */
export function isPublicDemo(): boolean {
  return process.env.WENSHAN_PUBLIC_DEMO === "1";
}
