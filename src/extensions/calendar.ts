export type CalendarEvent = { id: string; title: string; start: string; end: string; source: string };
export interface CalendarAdapter { listEvents(start: string, end: string): Promise<CalendarEvent[]> }
export class FixtureCalendar implements CalendarAdapter {
  constructor(private events: CalendarEvent[] = [
    {
      id: 'fixture-1',
      title: 'Example planning session (fixture)',
      start: '2026-10-24T09:00:00+06:00',
      end: '2026-10-24T09:30:00+06:00',
      source: 'calendar:fixture',
    },
  ]) {}
  async listEvents(start: string, end: string) {
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
      throw new Error('Invalid calendar interval');
    }
    return this.events.filter(event => Date.parse(event.start) < Date.parse(end) && Date.parse(event.end) > Date.parse(start));
  }
}
export class GoogleCalendar implements CalendarAdapter {
  async listEvents(_start: string, _end: string): Promise<CalendarEvent[]> {
    throw new Error('Google Calendar OAuth is not configured; use the fixture adapter');
  }
}
