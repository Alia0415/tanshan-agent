// Private deployment defaults. Never import this module from a Client Component.
// Environment variables take precedence. Keep distribution of this source private.
if (typeof window !== "undefined") throw new Error("Server configuration cannot run in a browser");
export const zhihuDeployment = {
  appId: "529",
  appKey: "",
  accessSecret: "",
  redirectUri: "https://tanshan-270489-8-1443398117.sh.run.tcloudbase.com/api/oauth/callback",
};
