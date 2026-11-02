// Time-of-day greeting based on the user's own device clock (their local
// time zone), never the server's. Bands: morning 5-12, afternoon 12-17,
// evening and night 17-5 ("Good night" is a goodbye in English, so late
// hours use "Good evening").
export function greetingFor(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}
