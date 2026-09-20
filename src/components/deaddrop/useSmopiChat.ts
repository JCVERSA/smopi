import { useCallback, useRef, useState } from 'react';
import type { SmopiAction, SmopiMessage } from '../../types';

export type ChatPhase = 'idle' | 'thinking' | 'tooling' | 'writing';

const WELCOME_ID = 'welcome';

/**
 * Chat state machine backed by the SSE endpoint.
 *
 * Streams `/api/smopi/chat/stream` and appends deltas to the in-flight model
 * message so text appears as it is generated. If the stream is unavailable
 * (older server, proxy that strips SSE, network error mid-flight) it falls
 * back to the buffered `/api/smopi/chat` endpoint, so behaviour degrades
 * rather than breaking.
 */
export function useSmopiChat(opts: {
  authToken: string | null;
  onFilesChanged: () => void;
  onPhase?: (phase: ChatPhase, detail?: string) => void;
  welcomeText: string;
}) {
  const { authToken, onFilesChanged, onPhase, welcomeText } = opts;

  const [messages, setMessages] = useState<SmopiMessage[]>(() => [
    {
      id: WELCOME_ID,
      role: 'model',
      text: welcomeText,
      timestamp: '',
      model: 'Smopi'
    }
  ]);
  const [phase, setPhase] = useState<ChatPhase>('idle');
  const [toolDetail, setToolDetail] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const isProcessing = phase !== 'idle';

  const setPhaseBoth = useCallback(
    (p: ChatPhase, detail?: string) => {
      setPhase(p);
      setToolDetail(detail);
      onPhase?.(p, detail);
    },
    [onPhase]
  );

  const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhaseBoth('idle');
    setMessages([
      { id: `${WELCOME_ID}-${Date.now()}`, role: 'model', text: welcomeText, timestamp: '', model: 'Smopi' }
    ]);
  }, [setPhaseBoth, welcomeText]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhaseBoth('idle');
  }, [setPhaseBoth]);

  const send = useCallback(
    async (rawText: string) => {
      const query = rawText.trim();
      if (!query || isProcessing) return;

      const modelId = `model-${Date.now()}`;
      const historyPayload = messages
        .filter((m) => !m.id.startsWith(WELCOME_ID))
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text }));

      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: 'user', text: query, timestamp: now() },
        { id: modelId, role: 'model', text: '', timestamp: now(), streaming: true, actions: [] }
      ]);
      setPhaseBoth('thinking');

      const controller = new AbortController();
      abortRef.current = controller;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const body = JSON.stringify({ message: query, history: historyPayload });

      const patch = (fn: (m: SmopiMessage) => SmopiMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === modelId ? fn(m) : m)));

      let sawAction = false;

      try {
        const res = await fetch('/api/smopi/chat/stream', {
          method: 'POST',
          headers,
          body,
          signal: controller.signal
        });

        if (!res.ok || !res.body) throw new Error(`stream unavailable (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        while (!done) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue; // comment/heartbeat
            let evt: any;
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (evt.type === 'status') {
              setPhaseBoth(evt.phase as ChatPhase, evt.detail);
            } else if (evt.type === 'action') {
              sawAction = true;
              patch((m) => ({ ...m, actions: [...(m.actions || []), evt.action as SmopiAction] }));
            } else if (evt.type === 'delta') {
              patch((m) => ({ ...m, text: m.text + evt.text }));
            } else if (evt.type === 'done') {
              patch((m) => ({
                ...m,
                text: evt.text || m.text,
                actions: (evt.actionsTaken as SmopiAction[]) || m.actions,
                model: evt.model,
                streaming: false
              }));
              if ((evt.actionsTaken || []).length > 0) sawAction = true;
              done = true;
            } else if (evt.type === 'error') {
              throw new Error(evt.error || 'Smopi failed');
            }
          }
        }

        patch((m) => ({ ...m, streaming: false }));
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          patch((m) => ({
            ...m,
            streaming: false,
            text: m.text || '_Stopped._'
          }));
          setPhaseBoth('idle');
          abortRef.current = null;
          return;
        }

        // Fall back to the buffered endpoint.
        try {
          setPhaseBoth('thinking');
          const res = await fetch('/api/smopi/chat', { method: 'POST', headers, body });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || `Server error ${res.status}`);
          }
          const data = await res.json();
          const actions: SmopiAction[] = data.actionsTaken || [];
          patch((m) => ({
            ...m,
            text: data.text || 'Done.',
            actions,
            model: data.model,
            streaming: false
          }));
          if (actions.length > 0) sawAction = true;
        } catch (fallbackErr: any) {
          patch((m) => ({
            ...m,
            streaming: false,
            text: `That didn't work: ${fallbackErr?.message || 'the task could not be completed'}.`
          }));
        }
      } finally {
        abortRef.current = null;
        setPhaseBoth('idle');
        if (sawAction) onFilesChanged();
      }
    },
    [authToken, isProcessing, messages, onFilesChanged, setPhaseBoth]
  );

  return { messages, phase, toolDetail, isProcessing, send, stop, reset };
}
