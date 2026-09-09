(() => {
  if (typeof aivastraSupportChat === 'undefined') {
    return;
  }

  var STATUS_COPY = {
    CONNECTING: 'Connecting…',
    OPEN: 'Connected',
    IN_PROGRESS: 'Connected — agent joined',
    RESOLVED: 'Resolved',
    CLOSED: 'Chat closed',
  };

  var startBtn = document.getElementById('aivastra-start-chat');
  var modal = document.getElementById('aivastra-chat-modal');
  var statusEl = document.getElementById('aivastra-chat-status');
  var errorEl = document.getElementById('aivastra-chat-error');
  var messagesEl = document.getElementById('aivastra-chat-messages');
  var composer = document.getElementById('aivastra-chat-composer');
  var input = document.getElementById('aivastra-chat-input');

  if (!startBtn || !modal) {
    return;
  }

  // Cached across opens within the same page load, same reasoning as
  // apps/shopify/src/hooks/useSupportChat.ts's tokenRef — avoids minting a
  // fresh platform JWT on every "Start a chat" click.
  var sessionToken = null;
  var socket = null;
  var conversationId = null;
  var typingTimeout = null;

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function setStatus(status) {
    statusEl.textContent = STATUS_COPY[status] || status;
    var closed = status === 'CLOSED';
    input.disabled = closed;
    composer.querySelector('button[type="submit"]').disabled = closed;
  }

  function appendMessage(role, content) {
    var row = document.createElement('div');
    row.className =
      'aivastra-chat-message aivastra-chat-message--' + (role === 'user' ? 'user' : 'agent');
    row.textContent = content;
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function fetchSessionToken() {
    var body = new URLSearchParams();
    body.set('action', 'aivastra_tryon_support_session');
    body.set('nonce', aivastraSupportChat.nonce);

    return fetch(aivastraSupportChat.ajaxUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success || !json.data || !json.data.token) {
          throw new Error((json.data && json.data.message) || 'Could not start a chat session.');
        }
        sessionToken = json.data.token;
        return sessionToken;
      });
  }

  function mintTicket(retrying) {
    return fetch(aivastraSupportChat.chatbotBase + '/ws-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sessionToken },
    }).then((res) => {
      if (res.status === 401 && !retrying) {
        // Mirrors useSupportChat.ts: a stale cached session token gets one
        // retry against a freshly minted one before giving up.
        sessionToken = null;
        return fetchSessionToken().then(() => mintTicket(true));
      }
      if (!res.ok) {
        throw new Error('Could not reach the chat service.');
      }
      return res.json().then((json) => json.ticket);
    });
  }

  function loadHistory(id) {
    fetch(aivastraSupportChat.chatbotBase + '/conversations/' + id + '/messages?limit=50', {
      headers: { Authorization: 'Bearer ' + sessionToken },
    })
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((json) => {
        (json.messages || []).forEach((m) => {
          appendMessage(m.role, m.content);
        });
      })
      .catch(() => {
        // History is a nice-to-have — the live socket still works without it.
      });
  }

  function connect() {
    clearError();
    setStatus('CONNECTING');

    var tokenPromise = sessionToken ? Promise.resolve(sessionToken) : fetchSessionToken();

    tokenPromise
      .then(() => mintTicket(false))
      .then((ticket) => {
        var wsUrl = aivastraSupportChat.chatbotBase.replace(/^http/, 'ws') + '/ws?ticket=' + ticket;
        socket = new WebSocket(wsUrl);

        socket.onmessage = (event) => {
          var frame;
          try {
            frame = JSON.parse(event.data);
          } catch (_e) {
            return;
          }

          if (frame.type === 'ready') {
            conversationId = frame.conversationId;
            setStatus(frame.status);
            loadHistory(conversationId);
          } else if (frame.type === 'message') {
            appendMessage(frame.message.role, frame.message.content);
          } else if (frame.type === 'state_change') {
            setStatus(frame.status);
          } else if (frame.type === 'typing') {
            statusEl.textContent = 'Typing…';
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(
              () => setStatus(conversationId ? 'OPEN' : 'CONNECTING'),
              4000,
            );
          } else if (frame.type === 'error') {
            showError(frame.message || 'Something went wrong.');
          }
        };

        socket.onclose = () => {
          socket = null;
        };
      })
      .catch((err) => {
        setStatus('CLOSED');
        showError(err.message || 'Could not start a chat session.');
      });
  }

  function disconnect() {
    if (socket) {
      socket.close();
      socket = null;
    }
    conversationId = null;
    messagesEl.innerHTML = '';
    clearError();
  }

  function openModal() {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    if (!socket) {
      connect();
    }
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    disconnect();
  }

  startBtn.addEventListener('click', openModal);
  modal.querySelectorAll('[data-aivastra-chat-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    var content = input.value.trim();
    if (!content || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type: 'message', content }));
    appendMessage('user', content);
    input.value = '';
  });
})();
