const connection = document.getElementById('connection');
const feedback = document.getElementById('feedback');
const token = document.getElementById('token');
const message = document.getElementById('message');
const state = document.getElementById('state');
const events = new EventSource('/api/events');
let pendingMessage;
events.onopen = () => {
  connection.textContent = 'Connected';
};
events.onerror = () => {
  connection.textContent = 'Disconnected; reconnecting automatically.';
};
events.addEventListener('state', event => {
  state.innerHTML = JSON.parse(event.data).html;
});
async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Rahat-Token': token.value.trim() },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error);
  }
  return result;
}
document.getElementById('message-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submittedMessage = message.value;
  const whenBusy = document.getElementById('when-busy').value;
  const sendButton = event.submitter;
  if (sendButton.disabled) {
    return;
  }
  sendButton.disabled = true;
  // Retain the request ID when retrying an uncertain HTTP admission.
  if (!pendingMessage || pendingMessage.message !== submittedMessage || pendingMessage.whenBusy !== whenBusy) {
    pendingMessage = { message: submittedMessage, whenBusy, requestId: crypto.randomUUID() };
  }
  try {
    const result = await post('/api/messages', pendingMessage);
    pendingMessage = undefined;
    if (message.value === submittedMessage) {
      message.value = '';
    }
    feedback.textContent = `Message admitted (${result.submissionId}).`;
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    sendButton.disabled = false;
  }
});
state.addEventListener('click', async event => {
  const button = event.target.closest('button[data-decision]');
  if (!button) {
    return;
  }
  button.disabled = true;
  try {
    await post('/api/actions', {
      decision: button.dataset.decision,
      id: button.dataset.actionId,
      payloadHash: button.dataset.hash,
    });
    feedback.textContent = 'Decision saved.';
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
