import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { log as addLog, logs, network, patchConsole, patchXhr, setOwnHost } from "./capture";

export type AstraTestOptions = {
  /** Your app's version, such as "1.4.0". */
  appVersion?: string;
  /** Your build number. */
  build?: string;
  /** Show the floating Report button. Defaults to true for pk_test_ keys, false for pk_live_. */
  showButton?: boolean;
  /** Record fetch / XMLHttpRequest calls (method, URL without query, status, timing). */
  captureNetwork?: boolean;
  /** Attach console output and uncaught errors to reports. */
  captureLogs?: boolean;
  /** Where reports are sent. */
  host?: string;
};

export type SentReport = { ref: string; url?: string; title?: string };

const COBALT = "#2F55D4", MIDNIGHT = "#0E1A3D";
const s: { key?: string; options: AstraTestOptions; reporter: Record<string, string>; testCase?: string; screen?: string; open?: () => void; capture?: () => Promise<string | undefined> } = { options: {}, reporter: {} };

// react-native-view-shot is optional: with it, reports carry a screenshot.
let captureRef: ((ref: unknown, opts: object) => Promise<string>) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  captureRef = require("react-native-view-shot").captureRef;
} catch {
  captureRef = undefined;
}

export const AstraTest = {
  /** Starts Astra Test. Call once, before your app renders. Then wrap your app in <AstraTestProvider>. */
  start(key: string, options: AstraTestOptions = {}) {
    if (s.key) return;
    if (!/^pk_(test|live)_[0-9a-f]{24}$/.test(key)) { console.warn("[AstraTest] That isn't a project key. Copy it from SDK setup in Astra Test."); return; }
    s.key = key; s.options = options;
    try { setOwnHost(new URL(options.host ?? "https://astratest.dev").host); } catch { /* keep default */ }
    if (options.captureLogs !== false) patchConsole();
    if (options.captureNetwork !== false) patchXhr();
    if (options.appVersion) post("/v1/builds", { key, platform: Platform.OS, version: options.appVersion, build: options.build ?? "" }).catch(() => undefined);
  },
  /** Says who is testing, so reports show their name and they can be asked if a fix works. */
  identify(user: { id?: string; email?: string; name?: string }) {
    s.reporter = Object.fromEntries(Object.entries(user).filter(([, v]) => !!v)) as Record<string, string>;
  },
  /** The test case being run, such as "UAT-02". */
  setTestCase(ref?: string) { s.testCase = ref; },
  /** The screen the user is on, such as "Checkout". Call it from your navigation's state listener. */
  setScreen(name?: string) { s.screen = name; },
  /** Adds a line to the log attached to reports. */
  log(message: string, level = "log") { addLog(level, message); },
  /** Opens the report sheet. */
  showReport() { s.open?.(); },
  /** Sends a report without the sheet, for example from your own feedback form. */
  async send(description: string): Promise<SentReport> { return send(description, await s.capture?.()); },
};

function payload(description: string, screenshot?: string) {
  const { width, height } = Dimensions.get("window");
  const screen = s.screen ?? "App";
  let locale = "en";
  try { locale = Intl.DateTimeFormat().resolvedOptions().locale; } catch { /* Intl missing */ }
  return {
    key: s.key,
    description,
    page: { url: `app://react-native/${screen}`, title: screen },
    device: {
      platform: Platform.OS,
      os: `${Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS} ${Platform.Version}`,
      browser: `React Native${(Platform.constants as { reactNativeVersion?: { major: number; minor: number } })?.reactNativeVersion ? ` ${(Platform.constants as { reactNativeVersion: { major: number; minor: number } }).reactNativeVersion.major}.${(Platform.constants as { reactNativeVersion: { major: number; minor: number } }).reactNativeVersion.minor}` : ""}`,
      viewport: `${Math.round(width)} × ${Math.round(height)}`,
      locale,
      appVersion: s.options.appVersion,
      build: s.options.build,
    },
    console: logs.all().slice(-60),
    network: network.all().slice(-60),
    reporter: Object.keys(s.reporter).length ? s.reporter : undefined,
    testCaseRef: s.testCase,
    screenshot,
  };
}

async function post(path: string, body: object) {
  const res = await fetch(`${s.options.host ?? "https://astratest.dev"}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { ref?: string; url?: string; title?: string; error?: string };
  if (!res.ok) throw new Error(j.error ?? `Couldn't send the report (${res.status})`);
  return j;
}

async function send(description: string, screenshot?: string): Promise<SentReport> {
  if (!s.key) throw new Error("Astra Test isn't started");
  const j = await post("/v1/reports", payload(description, screenshot));
  if (!j.ref) throw new Error(j.error ?? "Couldn't send the report");
  return { ref: j.ref, url: j.url, title: j.title };
}

const Masking = createContext(false);

/** Covers its children in report screenshots. Wrap password fields and anything private in it. */
export function AstraPrivate({ children }: { children: React.ReactNode }) {
  const masking = useContext(Masking);
  return <View>{children}{masking && <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} />}</View>;
}

/** Wrap your whole app in this, inside your providers. Adds the Report button and the report sheet. */
export function AstraTestProvider({ children }: { children: React.ReactNode }) {
  const root = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [masking, setMasking] = useState(false);
  const [shot, setShot] = useState<string>();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<SentReport>();

  const capture = useCallback(async () => {
    if (!captureRef || !root.current) return undefined;
    setMasking(true);
    await new Promise((r) => setTimeout(r, 60));
    try {
      const b64 = await captureRef(root.current, { format: "jpg", quality: 0.7, result: "base64" });
      return `data:image/jpeg;base64,${b64}`;
    } catch {
      return undefined;
    } finally {
      setMasking(false);
    }
  }, []);

  const show = useCallback(async () => {
    if (!s.key || open) return;
    setShot(await capture());
    setText(""); setError(undefined); setSent(undefined); setOpen(true);
  }, [capture, open]);

  useEffect(() => { s.open = show; s.capture = capture; return () => { s.open = undefined; s.capture = undefined; }; }, [show, capture]);

  const submit = async () => {
    const t = text.trim();
    if (t.length < 3 || sending) return;
    setSending(true); setError(undefined);
    try { setSent(await send(t, shot)); } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const showButton = !!s.key && (s.options.showButton ?? s.key.startsWith("pk_test_"));
  const nNet = network.all().length, nLog = logs.all().length;

  return (
    <Masking.Provider value={masking}>
      <View ref={root} collapsable={false} style={{ flex: 1 }}>{children}</View>
      {showButton && !open && (
        <Pressable accessibilityLabel="Report an issue" onPress={show} style={st.fab}>
          <Text style={st.fabText}>✦  Report</Text>
        </Pressable>
      )}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={st.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={st.sheet}>
            {sent ? (
              <>
                <Text style={st.sent}>✓  Sent as {sent.ref}</Text>
                <Text style={st.muted}>Thanks. We'll let you know when it's fixed.</Text>
                <Pressable onPress={() => setOpen(false)} style={st.done}><Text style={{ color: COBALT, fontWeight: "600" }}>Done</Text></Pressable>
              </>
            ) : (
              <>
                <View style={st.row}>
                  <Text style={st.title}>Report an issue</Text>
                  <Pressable onPress={() => setOpen(false)}><Text style={{ color: COBALT }}>Cancel</Text></Pressable>
                </View>
                <Text style={st.label}>What happened{s.screen ? ` on ${s.screen}` : ""}?</Text>
                <TextInput value={text} onChangeText={setText} placeholder="Say it in your own words" multiline style={st.input} autoFocus />
                <Text style={st.muted}>Attached: {[shot ? "Screenshot" : null, nNet ? `${nNet} requests` : null, nLog ? `${nLog} log lines` : null, "device details"].filter(Boolean).join(" · ")}</Text>
                {error && <Text style={st.error}>{error}</Text>}
                <Pressable onPress={submit} disabled={sending || text.trim().length < 3} style={[st.send, { opacity: sending || text.trim().length < 3 ? 0.45 : 1 }]}>
                  <Text style={st.sendText}>{sending ? "Sending…" : "Send report"}</Text>
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Masking.Provider>
  );
}

const st = StyleSheet.create({
  fab: { position: "absolute", right: 16, bottom: 40, backgroundColor: MIDNIGHT, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, elevation: 6, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 34, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "700", color: "#0F1115" },
  label: { fontSize: 12, color: "#646B78", marginTop: 6 },
  input: { minHeight: 90, borderWidth: 1, borderColor: "#8A909C", borderRadius: 8, padding: 10, fontSize: 15, textAlignVertical: "top" },
  muted: { fontSize: 12, color: "#646B78" },
  error: { fontSize: 13, color: "#B42318" },
  send: { backgroundColor: COBALT, borderRadius: 10, height: 46, alignItems: "center", justifyContent: "center", marginTop: 4 },
  sendText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  sent: { fontSize: 17, fontWeight: "700", color: "#0E7C66" },
  done: { alignSelf: "flex-end", padding: 8 },
});

export default AstraTest;
