// Development switches, set from the URL. Neither is reachable in the installed app.
//   ?local     never talk to Firebase; run on a throwaway sample outline
//   ?readonly  load and live-sync from Firebase but never write to it
const params = new URLSearchParams(location.search);

export const LOCAL_ONLY = params.has('local');
export const READ_ONLY = params.has('readonly');
