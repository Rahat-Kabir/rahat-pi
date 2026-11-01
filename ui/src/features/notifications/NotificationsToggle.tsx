import { useEffect, useState } from 'react';
import { describeError } from '../../api/client';
import {
  notificationButtonLabel, readNotificationStatus, turnOffNotifications, turnOnNotifications, type NotificationStatus,
} from './notifications';

export function NotificationsToggle() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    readNotificationStatus().then(setStatus, error => setFeedback(describeError(error)));
  }, []);
  if (!status) {
    return null;
  }

  async function toggle() {
    setBusy(true);
    setFeedback(null);
    try {
      setStatus(status === 'on' ? await turnOffNotifications() : await turnOnNotifications());
    } catch (error) {
      setFeedback(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  const canToggle = status === 'on' || status === 'off';
  return (
    <span className="ml-auto flex items-center gap-2">
      {feedback && <span role="alert" className="text-xs text-red-600 dark:text-red-400">{feedback}</span>}
      <button
        type="button"
        onClick={toggle}
        disabled={!canToggle || busy}
        aria-pressed={canToggle ? status === 'on' : undefined}
        title={status === 'on' ? 'Tap to turn notifications off on this device' : undefined}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed ${status === 'on'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'} ${canToggle ? '' : 'opacity-60'}`}
      >
        {status === 'on' ? '🔔 ' : '🔕 '}{notificationButtonLabel(status)}
      </button>
    </span>
  );
}
