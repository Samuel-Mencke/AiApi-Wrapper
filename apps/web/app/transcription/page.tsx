"use client";

import {
  AudioLines,
  Check,
  Clipboard,
  Copy,
  FileAudio,
  Loader2,
  Mic,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PUBLIC_API_URL } from "@/lib/api";

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResult {
  text: string;
  language?: string;
  language_probability?: number;
  duration?: number;
  segments?: TranscriptionSegment[];
}

interface WhisperHealth {
  status: string;
  model?: string;
  device?: string;
  compute_type?: string;
  model_loaded?: boolean;
  idle_unload_minutes?: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function preferredRecordingMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export default function TranscriptionPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [language, setLanguage] = useState("de");
  const [beamSize, setBeamSize] = useState("5");
  const [hotwords, setHotwords] = useState("");
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [processingMs, setProcessingMs] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<WhisperHealth | null>(null);

  const microphoneSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    fetch("/api/admin/audio/transcriptions/health", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        const payload = (await response.json()) as WhisperHealth;
        setHealth(payload);
        return payload;
      })
      .catch((healthError: Error) => {
        setHealth({ status: "unavailable", error: healthError.message });
      });
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((Date.now() - recordingStartedAtRef.current) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function selectAudio(file: File) {
    if (!file.type.startsWith("audio/")) {
      setError("Bitte eine Audiodatei auswählen.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Die Datei ist größer als das 15-MB-Limit.");
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;
    setAudioFile(file);
    setAudioUrl(nextUrl);
    setResult(null);
    setProcessingMs(null);
    setError("");
  }

  async function startRecording() {
    setError("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = preferredRecordingMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const recordedMime = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: recordedMime });
        const extension = extensionForMime(recordedMime);
        selectAudio(new File([blob], `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, { type: recordedMime }));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };

      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
      recorder.start(250);
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : "Mikrofon konnte nicht geöffnet werden.");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecording(false);
  }

  function clearAudio() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setAudioFile(null);
    setAudioUrl("");
    setResult(null);
    setProcessingMs(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) selectAudio(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) selectAudio(file);
  }

  async function transcribe() {
    if (!audioFile) return;
    setIsTranscribing(true);
    setError("");
    setResult(null);
    const startedAt = performance.now();

    try {
      const form = new FormData();
      form.append("file", audioFile, audioFile.name);
      form.append("language", language);
      form.append("beam_size", beamSize);
      form.append("response_format", "verbose_json");
      if (hotwords.trim()) form.append("hotwords", hotwords.trim());

      const response = await fetch("/api/admin/audio/transcriptions", {
        method: "POST",
        credentials: "include",
        body: form,
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.error ?? `Request failed: ${response.status}`);
      }

      setResult(payload as TranscriptionResult);
      setProcessingMs(performance.now() - startedAt);
      setHealth((current) => (current ? { ...current, model_loaded: true, status: "ok" } : current));
    } catch (transcriptionError) {
      setError(transcriptionError instanceof Error ? transcriptionError.message : "Transkription fehlgeschlagen.");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function copyTranscript() {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const curlCommand = `curl ${PUBLIC_API_URL}/v1/audio/transcriptions \\
  -H "Authorization: Bearer $MODEL_API_KEY" \\
  -F "file=@recording.webm" \\
  -F "language=de" \\
  -F "response_format=verbose_json"`;

  return (
    <PageShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)]">Voice Transcription</h1>
            <p className="mt-1 text-sm text-[#777]">Mikrofon aufnehmen oder eine Audiodatei über die produktive Transkriptionsroute testen.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.065] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            <span className={`h-2 w-2 rounded-full ${health?.status === "ok" ? "bg-[var(--success)]" : "bg-[var(--danger)]"}`} />
            {health?.status === "ok"
              ? `${health.model ?? "Whisper"} · ${health.model_loaded ? "geladen" : "bereit"}`
              : "Whisper nicht erreichbar"}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">{error}</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(330px,.92fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Audio input</CardTitle>
                <p className="mt-1 text-xs text-[#777]">WebM, WAV, MP3, OGG oder M4A · maximal 15 MB</p>
              </div>
              {audioFile ? (
                <Button variant="ghost" className="h-8 px-2" onClick={clearAudio} type="button">
                  <Trash2 className="h-3.5 w-3.5" /> Entfernen
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!microphoneSupported}
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`group flex min-h-32 flex-col items-center justify-center rounded-2xl border px-5 py-6 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    isRecording
                      ? "border-[var(--danger)]/35 bg-[var(--danger)]/10"
                      : "border-white/[0.075] bg-[var(--bg-elevated)] hover:border-white/[0.15] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  <span className={`grid h-12 w-12 place-items-center rounded-full ${isRecording ? "bg-[var(--danger)] text-white" : "bg-white/[0.07] text-[var(--text-secondary)]"}`}>
                    {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
                  </span>
                  <span className="mt-3 text-sm font-medium text-[var(--text-primary)]">
                    {isRecording ? `Aufnahme stoppen · ${formatTime(recordingSeconds)}` : "Mit Mikrofon aufnehmen"}
                  </span>
                  <span className="mt-1 text-xs text-[#777]">
                    {microphoneSupported ? "Direkt im Browser aufnehmen" : "Browser unterstützt keine Aufnahme"}
                  </span>
                </button>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
                  }}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition ${
                    isDragging ? "border-white/30 bg-white/[0.07]" : "border-white/[0.1] bg-[var(--bg-elevated)] hover:border-white/[0.18] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-white/[0.07] text-[var(--text-secondary)]"><Upload className="h-5 w-5" /></span>
                  <span className="mt-3 text-sm font-medium text-[var(--text-primary)]">Audiodatei auswählen</span>
                  <span className="mt-1 text-xs text-[#777]">Klicken oder hierher ziehen</span>
                  <input ref={fileInputRef} className="hidden" type="file" accept="audio/*,.webm,.m4a" onChange={handleFileInput} />
                </div>
              </div>

              {audioFile ? (
                <div className="rounded-2xl border border-white/[0.065] bg-[var(--bg-elevated)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.065] text-[var(--text-secondary)]"><FileAudio className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{audioFile.name}</div>
                      <div className="mt-0.5 text-xs text-[#777]">{formatBytes(audioFile.size)} · {audioFile.type || "audio"}</div>
                    </div>
                  </div>
                  <audio className="mt-4 w-full" controls src={audioUrl} preload="metadata" />
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs text-[var(--text-muted)]">
                  Sprache
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="h-10 w-full rounded-xl border border-white/[0.09] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-white/[0.24]"
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">Englisch</option>
                  </select>
                </label>
                <label className="space-y-2 text-xs text-[var(--text-muted)]">
                  Beam size
                  <select
                    value={beamSize}
                    onChange={(event) => setBeamSize(event.target.value)}
                    className="h-10 w-full rounded-xl border border-white/[0.09] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-white/[0.24]"
                  >
                    <option value="1">1 · schnell</option>
                    <option value="3">3 · ausgewogen</option>
                    <option value="5">5 · genauer</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-2 text-xs text-[var(--text-muted)]">
                Optionale Begriffe / Hotwords
                <Input value={hotwords} onChange={(event) => setHotwords(event.target.value)} placeholder="z. B. Samuel, Ableton, SL-LLM-R" />
              </label>

              <Button className="h-11 w-full" type="button" onClick={transcribe} disabled={!audioFile || isTranscribing || isRecording}>
                {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                {isTranscribing ? "Transkription läuft …" : "Audio transkribieren"}
              </Button>
              {isTranscribing && !health?.model_loaded ? (
                <p className="text-center text-xs text-[#777]">Der erste Lauf lädt das Large-v3-Modell in den Arbeitsspeicher.</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Transcript</CardTitle>
                  <p className="mt-1 text-xs text-[#777]">Ergebnis der aktuellen Aufnahme</p>
                </div>
                {result?.text ? (
                  <Button variant="secondary" className="h-8 px-2.5 text-xs" type="button" onClick={copyTranscript}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Kopiert" : "Kopieren"}
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {result ? (
                  <div className="space-y-4">
                    <div className="min-h-44 whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[var(--bg-input)] p-4 text-[15px] leading-7 text-[var(--text-primary)]">
                      {result.text || <span className="text-[var(--text-muted)]">Keine Sprache erkannt.</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                      <Metric label="Sprache" value={(result.language ?? language).toUpperCase()} />
                      <Metric label="Confidence" value={result.language_probability != null ? `${Math.round(result.language_probability * 100)}%` : "—"} />
                      <Metric label="Audio" value={result.duration != null ? formatTime(result.duration) : "—"} />
                      <Metric label="Verarbeitung" value={processingMs != null ? `${(processingMs / 1000).toFixed(1)}s` : "—"} />
                    </div>
                    {result.segments?.length ? (
                      <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-[var(--bg-input)] p-2">
                        {result.segments.map((segment) => (
                          <div key={`${segment.id}-${segment.start}`} className="grid grid-cols-[72px_1fr] gap-3 rounded-lg px-2 py-2 text-xs hover:bg-white/[0.035]">
                            <span className="font-mono text-[var(--text-muted)]">{formatTime(segment.start)}</span>
                            <span className="leading-5 text-[var(--text-secondary)]">{segment.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.075] bg-[var(--bg-elevated)] px-6 text-center">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-white/[0.055] text-[#777]"><Clipboard className="h-5 w-5" /></span>
                    <p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">Noch kein Transcript</p>
                    <p className="mt-1 max-w-xs text-xs leading-5 text-[var(--text-muted)]">Nimm Sprache auf oder lade Audio hoch und starte die Transkription.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Direkter API-Test</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-white/[0.06] bg-[var(--bg-input)] p-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                  <pre className="overflow-x-auto whitespace-pre-wrap">{curlCommand}</pre>
                </div>
                <p className="text-xs leading-5 text-[var(--text-muted)]">Die Mini-App nutzt dieselbe Verarbeitung über eine geschützte Admin-Route. Externe Clients verwenden den OpenAI-kompatiblen Endpoint mit API-Key.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.055] bg-[var(--bg-elevated)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}
