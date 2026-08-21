/** Headers shared by every server-side call to the private model worker. */
export function voiceServiceHeaders(
  token = process.env.VOICE_CLONE_TOKEN,
): Headers {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
