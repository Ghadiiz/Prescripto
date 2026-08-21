import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { AppContext } from '../context/AppContext';
import { handleAuthFailure } from '../utils/authInterceptor';

// Consumes the assistant's SSE stream.
//
// EventSource is not an option here, and that single fact shapes everything
// below: it only issues GET requests and cannot set an Authorization header,
// while /api/assistant/chat is a POST behind a Bearer token. So the stream is
// read by hand — fetch, getReader(), TextDecoder — and the `event:`/`data:`
// frames are parsed here.
//
// Rate-limited and at-capacity turns need no special handling: the server
// returns both as a normal 200 with token + done events (2.7 and 2.8), so they
// arrive as ordinary assistant messages.

const FALLBACK_ERROR =
  'I could not reach the assistant just now. Please try again in a moment.';

export const useAssistantChat = () => {
  const { backendUrl, token } = useContext(AppContext);

  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // An in-flight stream outlives the component unless it is cancelled, and
  // appending to state afterwards would be an update on an unmounted tree.
  useEffect(() => stop, [stop]);

  // Both deltas and cards land on the SAME assistant turn, so they share one
  // updater. Cards arrive during the tool rounds — before any text — so this
  // has to be able to open the turn as well as extend it.
  const updateAssistantTurn = useCallback((apply) => {
    setMessages((current) => {
      const next = [...current];
      const last = next.at(-1);

      if (last?.role === 'assistant') {
        next[next.length - 1] = apply(last);
      } else {
        next.push(apply({ role: 'assistant', content: '', cards: [] }));
      }

      return next;
    });
  }, []);

  const appendDelta = useCallback(
    (delta) =>
      updateAssistantTurn((turn) => ({ ...turn, content: turn.content + delta })),
    [updateAssistantTurn],
  );

  const appendCard = useCallback(
    (card) =>
      updateAssistantTurn((turn) => ({ ...turn, cards: [...turn.cards, card] })),
    [updateAssistantTurn],
  );

  const send = useCallback(
    async (text) => {
      const message = text.trim();
      if (!message || isStreaming) return;

      setError(null);
      setStatus(null);
      setIsStreaming(true);
      setMessages((current) => [...current, { role: 'user', content: message }]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`${backendUrl}/api/assistant/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });

        // fetch never reaches the axios interceptor, so the session handling
        // has to be invoked explicitly — otherwise an expired token would fail
        // silently here while every other request in the app logs the user out.
        if (response.status === 401 || response.status === 403) {
          handleAuthFailure();
          return;
        }

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setError(body?.message ?? FALLBACK_ERROR);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line. The final fragment is
          // usually incomplete, so it stays in the buffer for the next chunk —
          // dropping it would truncate a word mid-stream.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            if (!frame.trim()) continue;

            const name = frame.match(/^event: (.+)$/m)?.[1];
            const raw = frame.match(/^data: (.+)$/m)?.[1];
            if (!raw) continue;

            let data;
            try {
              data = JSON.parse(raw);
            } catch {
              continue;
            }

            if (name === 'status') {
              // For a multi-tool turn this is the only thing that arrives for
              // several seconds. Measured at nine, so it is not decoration.
              setStatus(data.tool);
            } else if (name === 'card') {
              // Structured rows straight from the database, already narrowed
              // by the server's allowlist. React renders them; the model's
              // prose only has to say what it found.
              appendCard(data);
            } else if (name === 'token') {
              setStatus(null);
              appendDelta(data.delta);
            } else if (name === 'done') {
              setStatus(null);
            } else if (name === 'error') {
              setError(data.message ?? FALLBACK_ERROR);
            }
          }
        }
      } catch (caught) {
        // Aborting is the user closing the panel, not a failure to report.
        if (caught.name !== 'AbortError') {
          console.error('Assistant stream failed:', caught);
          setError(FALLBACK_ERROR);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        setStatus(null);
      }
    },
    [appendCard, appendDelta, backendUrl, isStreaming, token],
  );

  return { messages, status, isStreaming, error, send, stop };
};

export default useAssistantChat;
