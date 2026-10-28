import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, Switch, Text, View } from "react-native";
import { useRpc, useSettings, useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { appsRpc, mergeEntries, openWithSettings, type App, type Entry } from "../shared/open-with";
import { messages } from "./messages";

type Props = PluginSurfaceProps & { onSaved(): void };

export function SettingsScreen(props: Props) {
  const state = useSettings(openWithSettings);
  const { t } = useTranslation(messages);
  const c = props.theme.colors;
  if (state.status !== "ready") {
    return (
      <View style={{ padding: 24, gap: 12 }}>
        <Text style={{ color: state.status === "loading" ? c.foregroundMuted : c.statusDanger }}>
          {state.status === "loading" ? t("loading") : state.error}
        </Text>
        {state.status !== "loading" && (
          <SettingsCard>
            <SettingsAction label={t("reload")} actionLabel={t("reload")} onPress={() => void state.reload()} />
            {state.status === "invalid" && (
              <SettingsAction label={t("restoreDefaults")} actionLabel={t("reset")} onPress={() => void state.reset()} />
            )}
          </SettingsCard>
        )}
      </View>
    );
  }
  return (
    <Editor
      key={state.revision}
      {...props}
      stored={state.values.entries}
      saving={state.saving}
      saveError={state.saveError}
      save={(entries) => state.save({ entries }, state.revision)}
    />
  );
}

function Editor({
  theme,
  stored,
  saving,
  saveError,
  save,
  onSaved,
}: Props & {
  stored: Entry[];
  saving: boolean;
  saveError: string | null;
  save(entries: Entry[]): Promise<boolean>;
}) {
  const { t } = useTranslation(messages);
  const c = theme.colors;
  const listApps = useRpc(appsRpc);
  const [draft, setDraft] = useState(() => mergeEntries(stored));
  const [apps, setApps] = useState<Map<string, App>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const loadApps = useCallback(() => {
    void listApps({})
      .then((result) => setApps(new Map(result.apps.map((app) => [app.id, app]))))
      .catch(() => {});
  }, [listApps]);
  useEffect(loadApps, [loadApps]);

  const change = (next: Entry[]) => {
    setDraft(next);
    setSaved(false);
    setError("");
  };
  const patch = (id: string, fields: Partial<Entry>) =>
    change(draft.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry)));
  const move = (index: number, by: number) => {
    const next = [...draft];
    const [entry] = next.splice(index, 1);
    next.splice(index + by, 0, entry!);
    change(next);
  };
  const add = () => {
    const id = `custom-${Date.now().toString(36)}`;
    change([...draft, { id, preset: "", name: "", icon: "", command: "", args: "", enabled: true }]);
    setEditing(id);
  };

  const saveNow = async () => {
    if (draft.some((entry) => !entry.preset && !entry.command.trim())) {
      setError(t("commandRequired"));
      return;
    }
    if (await save(draft)) {
      setSaved(true);
      onSaved();
    }
  };

  const iconButton = (name: string, label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}
    >
      <Icon name={name} size={16} color={c.foregroundMuted} />
    </Pressable>
  );

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t("apps")}>
        <SettingsCard>
          {draft.map((entry, index) => {
            const app = apps.get(entry.id);
            const name = entry.name || app?.defaults.name || entry.command || t("newApp");
            const open = editing === entry.id;
            return (
              <View key={entry.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  onPress={() => setEditing(open ? null : entry.id)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 }}
                >
                  {app?.image ? (
                    <Image source={{ uri: app.image }} style={{ width: 20, height: 20 }} />
                  ) : (
                    <Icon name={entry.icon || app?.icon || "AppWindow"} size={20} color={c.foreground} />
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: c.foreground, fontWeight: "500" }} numberOfLines={1}>
                      {name}
                    </Text>
                    {app && (
                      <Text style={{ color: c.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
                        {app.command ?? t("notFound")}
                      </Text>
                    )}
                  </View>
                  {iconButton("ChevronUp", t("moveUp"), () => move(index, -1), index === 0)}
                  {iconButton("ChevronDown", t("moveDown"), () => move(index, 1), index === draft.length - 1)}
                  <Switch value={entry.enabled} onValueChange={(enabled) => patch(entry.id, { enabled })} />
                </Pressable>
                {open && (
                  <EntryFields
                    key={`${entry.id}:${entry.preset ? JSON.stringify([entry.name, entry.command, entry.args, entry.icon]) : ""}`}
                    entry={entry}
                    app={app}
                    patch={(fields) => patch(entry.id, fields)}
                    remove={() => change(draft.filter((e) => e.id !== entry.id))}
                  />
                )}
              </View>
            );
          })}
          <SettingsAction label="" actionLabel={t("add")} onPress={add} />
        </SettingsCard>
      </SettingsSection>
      {(error || saveError) && <Text style={{ color: c.statusDanger }}>{error || saveError}</Text>}
      <SettingsCard>
        <SettingsAction
          label={saved ? t("saved") : ""}
          actionLabel={t("save")}
          disabled={saving}
          onPress={() => void saveNow()}
        />
      </SettingsCard>
    </View>
  );
}

function EntryFields({
  entry,
  app,
  patch,
  remove,
}: {
  entry: Entry;
  app: App | undefined;
  patch(fields: Partial<Entry>): void;
  remove(): void;
}) {
  const { t } = useTranslation(messages);
  const defaults = app?.defaults;
  return (
    <View>
      <SettingsInput
        label={t("name")}
        initialValue={entry.name}
        placeholder={defaults?.name}
        onChangeText={(name) => patch({ name })}
      />
      <SettingsInput
        label={t("command")}
        initialValue={entry.command}
        placeholder={defaults?.command ?? (entry.preset ? t("notFound") : "C:\\Program Files\\App\\App.exe")}
        onChangeText={(command) => patch({ command })}
      />
      <SettingsInput
        label={t("args")}
        hint={t("argsHint")}
        initialValue={entry.args}
        placeholder={defaults?.args ?? '"{path}"'}
        onChangeText={(args) => patch({ args })}
      />
      <SettingsInput
        label={t("icon")}
        hint={t("iconHint")}
        initialValue={entry.icon}
        placeholder={defaults?.icon ?? "AppWindow"}
        onChangeText={(icon) => patch({ icon })}
      />
      <SettingsRow label="">
        {entry.preset ? (
          <SettingsAction label="" actionLabel={t("reset")} onPress={() => patch({ name: "", command: "", args: "", icon: "" })} />
        ) : (
          <SettingsAction label="" actionLabel={t("remove")} onPress={remove} />
        )}
      </SettingsRow>
    </View>
  );
}
