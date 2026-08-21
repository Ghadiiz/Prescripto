import React, { useContext, useEffect, useRef, useState } from 'react';

import { AppContext } from '../context/AppContext';
import { useAssistantChat } from '../hooks/useAssistantChat';
import DoctorCard from './DoctorCard';
import AvailabilityCard from './AvailabilityCard';
import ThinkingIndicator from './ThinkingIndicator';
import TurnNotice from './TurnNotice';
import { REPLACES_BUBBLE, stopExplanation } from '../utils/turnPresentation';

// The assistant panel.
//
// How a turn is presented depends on how it ENDED. The mapping is not uniform,
// because the content behind each stoppedReason is not uniform:
//
//   emergency     the content is guaranteed to be the fixed safety text (the
//                 check returns before any model call), so the notice replaces
//                 the bubble entirely.
//   rate_limited  likewise fixed, and sent before the stream carries anything.
//   at_capacity   MAY include a partial answer, because the cap can trip
//                 mid-turn after tokens have streamed. Still shown as a
//                 notice; the partial text stays readable inside it.
//   iteration_cap content is `lastText || CAP_MESSAGE` — usually the model's
//                 own words. So the bubble stays and the notice is ADDED, or a
//                 real answer would be dressed up as a system message.

const AssistantPanel = () => {
  const { token } = useContext(AppContext);
  const {
    messages,
    status,
    isStreaming,
    error,
    startedAt,
    send,
    retry,
    stop,
    canRetry,
  } = useAssistantChat();

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const threadRef = useRef(null);

  // Follow the stream as it grows rather than leaving the newest text below
  // the fold.
  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, status, error]);

  // The endpoint is patient-only, so offering this to a signed-out visitor
  // would just be a dead end.
  if (!token) return null;

  const submit = (event) => {
    event.preventDefault();
    send(draft);
    setDraft('');
  };

  // Closing is an explicit dismissal, so it aborts whatever is in flight.
  const close = () => {
    stop();
    setIsOpen(false);
  };

  // Collapsing is not closing. Tapping a doctor gets the panel out of the way
  // — on mobile it is full-screen and would cover the booking page — but it
  // must NOT abort: the provider call is already made and already paid for.
  // Aborting would bin an answer we have been charged for, and skip saving the
  // turn. Left alone it finishes, and reopening shows the completed reply.
  //
  // The thread survives regardless: AssistantPanel is mounted in App.jsx
  // outside <Routes>, so changing route does not unmount it.
  const collapse = () => setIsOpen(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open the booking assistant"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-lg transition hover:scale-105"
      >
        💬
      </button>
    );
  }

  return (
    // z-40: the Navbar's mobile menu already claims z-20.
    <section
      aria-label="Booking assistant"
      className="fixed inset-0 z-40 flex flex-col bg-white sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[600px] sm:max-h-[80vh] sm:w-96 sm:rounded-xl sm:border sm:border-gray-200 sm:shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <p className="font-medium">Booking assistant</p>
          <p className="text-xs text-gray-500">
            Finds doctors — it cannot book for you
          </p>
        </div>
        <button
          onClick={close}
          aria-label="Close the booking assistant"
          className="text-2xl leading-none text-gray-400 hover:text-gray-700"
        >
          ×
        </button>
      </header>

      <div
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm"
      >
        {messages.length === 0 && (
          <p className="text-gray-500">
            Ask about a speciality, an area, or your own appointments — for
            example, “which dermatologists are in Khalda?”
          </p>
        )}

        {messages.map((message, index) => {
          const asNotice =
            message.role === 'assistant' &&
            REPLACES_BUBBLE.includes(message.stoppedReason);
          const explanation =
            message.role === 'assistant'
              ? stopExplanation(message.stoppedReason)
              : null;

          return (
            <div key={index} className="space-y-2">
              {asNotice ? (
                <TurnNotice
                  stoppedReason={message.stoppedReason}
                  retryAfterSeconds={message.retryAfterSeconds}
                >
                  {message.content}
                </TurnNotice>
              ) : (
                <div
                  className={
                    message.role === 'user'
                      ? 'flex justify-end'
                      : 'flex justify-start'
                  }
                >
                  {/* An empty assistant turn exists while its cards stream in
                      and before any text arrives — don't render an empty
                      bubble. */}
                  {message.content && (
                    <p
                      className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 ${
                        message.role === 'user'
                          ? 'bg-primary text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {message.content}
                    </p>
                  )}
                </div>
              )}

              {/* Added to the bubble rather than replacing it: the content is
                  the model's own partial answer, not a fixed message. */}
              {explanation && (
                <TurnNotice stoppedReason={message.stoppedReason}>
                  {explanation}
                </TurnNotice>
              )}

            {/* Cards arrive before the prose, so they sit above it — the
                patient sees what was found while the answer is still being
                written. */}
              {message.cards?.map((card, cardIndex) =>
                card.kind === 'doctors' ? (
                  card.doctors.map((doctor) => (
                    <DoctorCard
                      key={`${cardIndex}-${doctor.id}`}
                      doctor={doctor}
                      onNavigate={collapse}
                    />
                  ))
                ) : card.kind === 'availability' ? (
                  <AvailabilityCard key={cardIndex} availability={card} />
                ) : null,
              )}
            </div>
          );
        })}

        {isStreaming && (
          <ThinkingIndicator status={status} startedAt={startedAt} />
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
            <p className="text-xs">{error}</p>
            {canRetry && (
              <button
                type="button"
                onClick={retry}
                className="mt-1.5 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium hover:bg-red-100"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-gray-200 px-4 py-3"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline, as in every chat app.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(event);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ask about doctors or your appointments"
          aria-label="Message"
          disabled={isStreaming}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary disabled:bg-gray-50"
        />
        {isStreaming ? (
          // The request has already gone out and already cost a call, so this
          // stops the waiting, not the spending. Worth having anyway: a
          // 40-second wait for an answer to the wrong question is worse.
          <button
            type="button"
            onClick={stop}
            title="Stops waiting for the reply. The request has already been sent."
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
};

export default AssistantPanel;
