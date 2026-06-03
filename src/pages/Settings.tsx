import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Wifi, Plus, Trash2, Key, Server, Mic } from "lucide-react";
import { loadProviderSettings, saveProviderSettings, INWORLD_VOICES, IMAGE_MODELS, ASPECT_RATIOS, type ProviderSettings } from "@/lib/providers";
import { GROQ_MODELS } from "../../shared/scriptToJsonUtils";

type HealthStatus = "idle" | "checking" | "ok" | "error";
type Tab = "connections" | "providers" | "voices";

function StatusIndicator({ status, message }: { status: HealthStatus; message?: string }) {
  if (status === "idle") return null;
  if (status === "checking") return <Badge variant="secondary" className="text-xs"><Loader2 className="h-3 w-3 animate-spin mr-1" />Checking...</Badge>;
  if (status === "ok") return <Badge className="bg-success/20 text-success border-success/30 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>;
  return (
    <div className="space-y-1">
      <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<ProviderSettings>(loadProviderSettings);
  const [activeTab, setActiveTab] = useState<Tab>("connections");
  const [newVoiceId, setNewVoiceId] = useState("");
  const [newVoiceName, setNewVoiceName] = useState("");
  const [showGroq, setShowGroq] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showInworld, setShowInworld] = useState(false);
  const [showNvidia, setShowNvidia] = useState(false);
  const [showGemini, setShowGemini] = useState(false);

  const [groqStatus, setGroqStatus] = useState<HealthStatus>("idle");
  const [groqMsg, setGroqMsg] = useState("");
  const [anthropicStatus, setAnthropicStatus] = useState<HealthStatus>("idle");
  const [anthropicMsg, setAnthropicMsg] = useState("");
  const [nvidiaStatus, setNvidiaStatus] = useState<HealthStatus>("idle");
  const [nvidiaMsg, setNvidiaMsg] = useState("");
  const [geminiStatus, setGeminiStatus] = useState<HealthStatus>("idle");
  const [geminiMsg, setGeminiMsg] = useState("");
  const [inworldStatus, setInworldStatus] = useState<HealthStatus>("idle");
  const [inworldMsg, setInworldMsg] = useState("");
  const [renderStatus, setRenderStatus] = useState<HealthStatus>("idle");
  const [renderMsg, setRenderMsg] = useState("");

  const save = () => {
    saveProviderSettings(settings);
    toast.success("Settings saved");
  };

  const testGroq = async () => {
    if (!settings.groqApiKey) { setGroqStatus("error"); setGroqMsg("No API key provided"); return; }
    setGroqStatus("checking"); setGroqMsg("");
    try {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${settings.groqApiKey}` },
      });
      if (res.status === 401) { setGroqStatus("error"); setGroqMsg("Invalid API key"); return; }
      if (res.status === 429) { setGroqStatus("error"); setGroqMsg("Rate limited — try again later"); return; }
      if (!res.ok) { setGroqStatus("error"); setGroqMsg(`HTTP ${res.status}`); return; }
      setGroqStatus("ok");
    } catch (e: any) {
      setGroqStatus("error"); setGroqMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };

  const testAnthropic = async () => {
    const isVertex = settings.claudeModel?.startsWith("publishers/") || 
                     settings.claudeModel?.includes("@") || 
                     settings.claudeModel === "claude-haiku-4-5" || 
                     settings.claudeModel === "claude-sonnet-4-6";
    
    if (!settings.anthropicApiKey && !isVertex) { 
      setAnthropicStatus("error"); 
      setAnthropicMsg("No API key provided"); 
      return; 
    }
    setAnthropicStatus("checking"); setAnthropicMsg("");
    try {
      const res = await fetch("/api/gemini-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "claude-chat",
          apiKey: settings.anthropicApiKey,
          payload: {
            model: settings.claudeModel || "claude-haiku-4-5-20251001",
            max_tokens: 10,
            messages: [{ role: "user", content: "Say ok" }],
          }
        })
      });
      const data = await res.json();
      if (res.status === 401 || data?.status === 401) { setAnthropicStatus("error"); setAnthropicMsg("Invalid API key"); return; }
      if (!res.ok || data?.error) { setAnthropicStatus("error"); setAnthropicMsg(data?.error || `HTTP ${res.status}`); return; }
      setAnthropicStatus("ok");
    } catch (e: any) {
      setAnthropicStatus("error"); setAnthropicMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };

  const testNvidia = async () => {
    const key = settings.nvidiaApiKey || "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";
    setNvidiaStatus("checking"); setNvidiaMsg("");
    try {
      const res = await fetch("/api/gemini-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "nvidia-chat",
          apiKey: key,
          payload: {
            model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
            messages: [{ role: "user", content: "Say ok" }],
            max_tokens: 10,
            extra_body: {
              chat_template_kwargs: { enable_thinking: false }
            }
          }
        })
      });
      const data = await res.json();
      if (res.status === 401 || data?.status === 401) { setNvidiaStatus("error"); setNvidiaMsg("Invalid API key"); return; }
      if (!res.ok || data?.error) { setNvidiaStatus("error"); setNvidiaMsg(data?.error || `HTTP ${res.status}`); return; }
      setNvidiaStatus("ok");
    } catch (e: any) {
      setNvidiaStatus("error"); setNvidiaMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };

  const testInworld = async () => {
    if (!settings.inworldApiKey) { setInworldStatus("error"); setInworldMsg("No API key provided"); return; }
    setInworldStatus("checking"); setInworldMsg("");
    try {
      const res = await fetch("https://api.inworld.ai/tts/v1/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${settings.inworldApiKey}` },
        body: JSON.stringify({
          text: "test", voiceId: "Dennis", modelId: "inworld-tts-1.5-max",
          audioConfig: { audioEncoding: "MP3", sampleRateHertz: 22050 },
          temperature: 1.0, applyTextNormalization: "ON",
        }),
      });
      if (res.status === 401 || res.status === 403) { setInworldStatus("error"); setInworldMsg("Invalid API key"); return; }
      if (res.status === 429) { setInworldStatus("error"); setInworldMsg("Rate limited"); return; }
      if (!res.ok) { setInworldStatus("error"); setInworldMsg(`HTTP ${res.status}`); return; }
      const data = await res.json();
      if (!data?.audioContent) { setInworldStatus("error"); setInworldMsg("No audio returned"); return; }
      setInworldStatus("ok");
    } catch (e: any) {
      setInworldStatus("error"); setInworldMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };

  const testRenderApi = async () => {
    setRenderStatus("checking"); setRenderMsg("");
    try {
      const res = await fetch("/api/render/health");
      const data = await res.json();
      if (data.ok) { setRenderStatus("ok"); setRenderMsg(`${data.ms}ms · ${data.url}`); }
      else { setRenderStatus("error"); setRenderMsg(data.error ?? `HTTP ${data.status}`); }
    } catch (e: any) {
      setRenderStatus("error"); setRenderMsg("Could not reach server");
    }
  };

  const testGemini = async () => {
    if (!settings.geminiApiKey) { setGeminiStatus("error"); setGeminiMsg("No API key provided"); return; }
    setGeminiStatus("checking"); setGeminiMsg("");
    try {
      const res = await fetch("/api/gemini-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "gemini-chat",
          apiKey: settings.geminiApiKey,
          payload: {
            model: settings.geminiModel || "gemini-3.5-flash",
            contents: [{ role: "user", parts: [{ text: "Say ok" }] }],
            generationConfig: {
              maxOutputTokens: 10,
              thinkingConfig: {
                thinkingLevel: "MEDIUM"
              }
            }
          }
        })
      });
      const data = await res.json();
      if (res.status === 401 || data?.status === 401) { setGeminiStatus("error"); setGeminiMsg("Invalid API key"); return; }
      if (!res.ok || data?.error) { setGeminiStatus("error"); setGeminiMsg(data?.error || `HTTP ${res.status}`); return; }
      setGeminiStatus("ok");
    } catch (e: any) {
      setGeminiStatus("error"); setGeminiMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };

  const testAll = () => { testGroq(); testAnthropic(); testNvidia(); testGemini(); testInworld(); testRenderApi(); };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "connections", label: "Connections", icon: <Key className="h-4 w-4" /> },
    { id: "providers",   label: "Providers",   icon: <Server className="h-4 w-4" /> },
    { id: "voices",      label: "Voices",      icon: <Mic className="h-4 w-4" /> },
  ];

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display text-foreground">Settings</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={testAll}>
            <Wifi className="h-4 w-4 mr-2" />Test All
          </Button>
          <Button onClick={save} size="sm" className="font-display">
            <Save className="h-4 w-4 mr-2" />Save
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── CONNECTIONS TAB ───────────────────────────────────────────── */}
      {activeTab === "connections" && (
        <div className="space-y-6">
          {/* Render API */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">Render API (FFmpeg Server)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">FFmpeg Render Server</p>
                  <p className="text-xs text-muted-foreground">Ken Burns animation, video merging, transitions</p>
                </div>
                <div className="flex items-center gap-2">
                  {renderStatus !== "idle" && (
                    <div className="space-y-1 text-right">
                      <StatusIndicator status={renderStatus} />
                      {renderMsg && <p className="text-xs text-muted-foreground max-w-[200px] truncate">{renderMsg}</p>}
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={testRenderApi} className="text-xs h-7">
                    {renderStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test Connection"}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground bg-secondary rounded px-3 py-2">
                <span className="text-foreground font-medium">Endpoints:</span> /animate · /merge · /concat-transitions
              </p>
            </CardContent>
          </Card>

          {/* API Keys */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">API Keys</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Groq */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Groq API Key</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={groqStatus} message={groqMsg} />
                    <Button variant="ghost" size="sm" onClick={testGroq} className="text-xs h-7">
                      {groqStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showGroq ? "text" : "password"}
                    placeholder="gsk_..."
                    value={settings.groqApiKey}
                    onChange={(e) => { setSettings(s => ({ ...s, groqApiKey: e.target.value })); setGroqStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowGroq(!showGroq)}>
                    {showGroq ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Scene splitting and prompt generation — get one at console.groq.com</p>
              </div>

              {(settings.textProvider === "groq" || (settings.groqApiKey || "").length > 0) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Groq Model</label>
                  <Select
                    value={settings.groqModel || "llama-3.3-70b-versatile"}
                    onValueChange={(v) => setSettings(s => ({ ...s, groqModel: v }))}
                  >
                    <SelectTrigger className="bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GROQ_MODELS.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} {m.tpd !== "No limit" ? `(${(m.tpd as number / 1000).toFixed(0)}K TPD)` : "(No limit)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Free plan: Llama 4 Scout has 500K tokens/day vs 100K for 70B</p>
                </div>
              )}

              <div className="border-t border-border" />

              {/* Anthropic */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Anthropic API Key</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={anthropicStatus} message={anthropicMsg} />
                    <Button variant="ghost" size="sm" onClick={testAnthropic} className="text-xs h-7">
                      {anthropicStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showAnthropic ? "text" : "password"}
                    placeholder="sk-ant-..."
                    value={settings.anthropicApiKey || ""}
                    onChange={(e) => { setSettings(s => ({ ...s, anthropicApiKey: e.target.value })); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowAnthropic(!showAnthropic)}>
                    {showAnthropic ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Uses Claude for scene &amp; image prompt generation. If set, Groq key is not needed.</p>
              </div>

              {(settings.textProvider === "claude" || (settings.anthropicApiKey || "").length > 0) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Claude Model</label>
                  <Select
                    value={settings.claudeModel || "claude-haiku-4-5-20251001"}
                    onValueChange={(v) => setSettings(s => ({ ...s, claudeModel: v }))}
                  >
                    <SelectTrigger className="bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude-sonnet-4-6@default">Sonnet 4.6 (Vertex AI)</SelectItem>
                      <SelectItem value="claude-haiku-4-5-20251001">Haiku 4.5 (Anthropic API)</SelectItem>
                      <SelectItem value="claude-haiku-4-5@20251001">Haiku 4.5 (Vertex AI)</SelectItem>
                      <SelectItem value="claude-3-5-sonnet-latest">Sonnet 3.5 (Anthropic API)</SelectItem>
                      <SelectItem value="claude-3-haiku-20240307">Haiku 3 (Anthropic API)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="border-t border-border" />

              {/* Nvidia */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Nvidia API Key</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={nvidiaStatus} message={nvidiaMsg} />
                    <Button variant="ghost" size="sm" onClick={testNvidia} className="text-xs h-7">
                      {nvidiaStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showNvidia ? "text" : "password"}
                    placeholder="nvapi-..."
                    value={settings.nvidiaApiKey}
                    onChange={(e) => { setSettings(s => ({ ...s, nvidiaApiKey: e.target.value })); setNvidiaStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowNvidia(!showNvidia)}>
                    {showNvidia ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Nemotron reasoning model key — optional (falls back to default key if empty)</p>
              </div>

              <div className="border-t border-border" />

              {/* Gemini */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Gemini API Key</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={geminiStatus} message={geminiMsg} />
                    <Button variant="ghost" size="sm" onClick={testGemini} className="text-xs h-7">
                      {geminiStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showGemini ? "text" : "password"}
                    placeholder="AIzaSy..."
                    value={settings.geminiApiKey || ""}
                    onChange={(e) => { setSettings(s => ({ ...s, geminiApiKey: e.target.value })); setGeminiStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowGemini(!showGemini)}>
                    {showGemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Google AI Studio API Key — get one at aistudio.google.com</p>
              </div>

              {(settings.textProvider === "gemini" || (settings.geminiApiKey || "").length > 0) && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Gemini Model</label>
                  <Select
                    value={settings.geminiModel || "gemini-3.5-flash"}
                    onValueChange={(v) => setSettings(s => ({ ...s, geminiModel: v }))}
                  >
                    <SelectTrigger className="bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash</SelectItem>
                      <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                      <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="border-t border-border" />

              {/* Inworld */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Inworld API Key</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={inworldStatus} message={inworldMsg} />
                    <Button variant="ghost" size="sm" onClick={testInworld} className="text-xs h-7">
                      {inworldStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showInworld ? "text" : "password"}
                    placeholder="Base64 encoded key"
                    value={settings.inworldApiKey}
                    onChange={(e) => { setSettings(s => ({ ...s, inworldApiKey: e.target.value })); setInworldStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowInworld(!showInworld)}>
                    {showInworld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Inworld TTS key (Base64 encoded) — get one at inworld.ai/studio</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── PROVIDERS TAB ─────────────────────────────────────────────── */}
      {activeTab === "providers" && (
        <div className="space-y-6">
          {/* Text Generation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">Text Generation / Script Parsing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">AI Text Provider</label>
                <Select
                  value={settings.textProvider || "groq"}
                  onValueChange={(v) => setSettings(s => ({ ...s, textProvider: v as "groq" | "claude" | "nvidia" | "gemini" }))}
                >
                  <SelectTrigger className="bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="groq">Llama 3.3 70B (Groq)</SelectItem>
                    <SelectItem value="claude">Claude (Anthropic)</SelectItem>
                    <SelectItem value="nvidia">Nemotron 3 Nano Reasoning (Nvidia - 65k context)</SelectItem>
                    <SelectItem value="gemini">Gemini 3.5 Flash (Google)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Select the AI provider used for scene manifest creation and prompt generation.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">Image Generation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Image Provider</label>
                <Select
                  value={settings.imageProvider}
                  onValueChange={(v) => setSettings(s => ({ ...s, imageProvider: v }))}
                >
                  <SelectTrigger className="bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Vertex AI (Imagen / Gemini)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Default Image Model</label>
                <Select
                  value={settings.imageModel || "imagen-4.0-fast-generate-001"}
                  onValueChange={(v) => setSettings(s => ({ ...s, imageModel: v }))}
                >
                  <SelectTrigger className="bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_MODELS.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Aspect Ratio</label>
                <Select
                  value={settings.aspectRatio || "16:9"}
                  onValueChange={(v) => setSettings(s => ({ ...s, aspectRatio: v as "16:9" | "9:16" }))}
                >
                  <SelectTrigger className="bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Applied to all image models — 16:9 for landscape, 9:16 for portrait</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Image Concurrency: {settings.imageConcurrency}
                </label>
                <Slider
                  value={[settings.imageConcurrency]}
                  onValueChange={([v]) => setSettings(s => ({ ...s, imageConcurrency: v }))}
                  min={1} max={5} step={1}
                />
                <p className="text-xs text-muted-foreground">Number of images generated in parallel</p>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div>
                  <label className="text-sm font-medium text-foreground">Generate Images</label>
                  <p className="text-xs text-muted-foreground">Turn off to skip image generation for new projects</p>
                </div>
                <Switch
                  checked={!settings.skipImageGeneration}
                  onCheckedChange={(checked) => setSettings(s => ({ ...s, skipImageGeneration: !checked }))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">Text-to-Speech</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">TTS Provider</label>
                <Select
                  value={settings.ttsProvider}
                  onValueChange={(v) => setSettings(s => ({ ...s, ttsProvider: v }))}
                >
                  <SelectTrigger className="bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inworld">Inworld AI</SelectItem>
                  </SelectContent>
                </Select>
                {settings.ttsProvider === "inworld" && !settings.inworldApiKey && (
                  <p className="text-xs text-destructive">⚠ Inworld API Key required — configure it in the Connections tab</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">TTS Model</label>
                <Select
                  value={settings.modelId}
                  onValueChange={(v) => setSettings(s => ({ ...s, modelId: v }))}
                >
                  <SelectTrigger className="bg-secondary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inworld-tts-2">TTS 2 (Latest)</SelectItem>
                    <SelectItem value="inworld-tts-1.5-max">TTS 1.5 Max (Best Quality)</SelectItem>
                    <SelectItem value="inworld-tts-1.5-mini">TTS 1.5 Mini (Faster)</SelectItem>
                    <SelectItem value="inworld-tts-1-max">TTS 1.0 Max (Legacy)</SelectItem>
                    <SelectItem value="inworld-tts-1">TTS 1.0 (Legacy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Audio Concurrency: {settings.audioConcurrency}
                </label>
                <Slider
                  value={[settings.audioConcurrency]}
                  onValueChange={([v]) => setSettings(s => ({ ...s, audioConcurrency: v }))}
                  min={1} max={5} step={1}
                />
                <p className="text-xs text-muted-foreground">Number of audio tracks generated in parallel</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── VOICES TAB ────────────────────────────────────────────────── */}
      {activeTab === "voices" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">Default Voice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-sm font-medium text-foreground">Voice</label>
              <Select
                value={settings.voiceId}
                onValueChange={(v) => setSettings(s => ({ ...s, voiceId: v }))}
              >
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_group_builtin" disabled className="text-xs font-semibold text-muted-foreground">— Built-in Voices —</SelectItem>
                  {INWORLD_VOICES.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} — {v.description}
                    </SelectItem>
                  ))}
                  {(settings.customVoices || []).length > 0 && (
                    <SelectItem value="_group_custom" disabled className="text-xs font-semibold text-muted-foreground">— Custom Voices —</SelectItem>
                  )}
                  {(settings.customVoices || []).map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} (custom)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Default voice for all new scenes. Can be overridden per scene.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-display">Custom Voices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">Add a voice by its Inworld voice ID and a display name.</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Voice ID (e.g. Jordan)"
                  value={newVoiceId}
                  onChange={(e) => setNewVoiceId(e.target.value)}
                  className="bg-secondary flex-1"
                  data-testid="input-custom-voice-id"
                />
                <Input
                  placeholder="Display name"
                  value={newVoiceName}
                  onChange={(e) => setNewVoiceName(e.target.value)}
                  className="bg-secondary flex-1"
                  data-testid="input-custom-voice-name"
                />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="button-add-custom-voice"
                  onClick={() => {
                    const id = newVoiceId.trim();
                    const name = newVoiceName.trim() || id;
                    if (!id) return;
                    const existing = settings.customVoices || [];
                    if (existing.some(v => v.id === id)) { toast.error("A voice with that ID already exists."); return; }
                    setSettings(s => ({ ...s, customVoices: [...(s.customVoices || []), { id, name }] }));
                    setNewVoiceId("");
                    setNewVoiceName("");
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(settings.customVoices || []).length > 0 ? (
                <div className="space-y-2">
                  {(settings.customVoices || []).map(v => (
                    <div key={v.id} className="flex items-center justify-between bg-secondary rounded px-3 py-2">
                      <div>
                        <span className="text-sm font-medium">{v.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">ID: {v.id}</span>
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-voice-${v.id}`}
                        onClick={() => setSettings(s => ({ ...s, customVoices: (s.customVoices || []).filter(x => x.id !== v.id) }))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No custom voices added yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
