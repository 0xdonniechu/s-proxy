export type AppLanguage = "vi" | "en";
export type SlotMode = "adapter_bridge" | "userspace_wg";
export type SlotRuntimeStatus = "stopped" | "running" | "kill_switch" | "error";
export type LeakStatus = "unchecked" | "safe" | "leak_blocked" | "error";
export type AdapterKind = "surfshark" | "other_vpn" | "primary_isp";
export type LocationType = "generic" | "static";

export interface EgressCheckResult {
  exitIp: string;
  country: string;
  city: string;
  org: string;
  latencyMs: number;
  leakStatus: LeakStatus;
  checkedAtEpochS: number;
  errorMessage: string;
}

export interface DetectedAdapter {
  name: string;
  description: string;
  ifIndex: number;
  ipv4: string;
  statusUp: boolean;
  isDefaultRoute: boolean;
  kind: AdapterKind;
}

export interface SurfsharkLocation {
  id: string;
  country: string;
  countryCode: string;
  location: string;
  region: string;
  load: number;
  connectionName: string;
  pubKey: string;
  locationType: LocationType;
}

export interface GoLoginProfileSummary {
  id: string;
  name: string;
  os: string;
  proxyMode: string;
  proxyHost: string;
  proxyPort: number;
}

export interface SettingsView {
  hasWgPrivateKey: boolean;
  wgPrivateKeyMasked: string;
  wgAddress: string;
  wgDns: string;
  hasGologinToken: boolean;
  gologinTokenMasked: string;
  basePort: number;
  allowLan: boolean;
  language: AppLanguage;
  wireproxyPath: string;
  wireproxyReady: boolean;
}

export interface SettingsUpdatePayload {
  wgPrivateKey: string | null;
  wgAddress: string;
  wgDns: string;
  gologinToken: string | null;
  basePort: number;
  allowLan: boolean;
  language: AppLanguage;
  wireproxyPath: string;
}

export interface ProxySlotView {
  id: string;
  name: string;
  port: number;
  listenHost: string;
  socks5Uri: string;
  httpUri: string;
  mode: SlotMode;
  locationId: string;
  countryCode: string;
  locationLabel: string;
  connectionName: string;
  adapterHint: string;
  boundAdapterName: string;
  boundAdapterIp: string;
  status: SlotRuntimeStatus;
  statusDetail: string;
  activeConnections: number;
  bytesTransferred: number;
  egress: EgressCheckResult | null;
  linkedGologinProfileId: string;
  linkedGologinProfileName: string;
  autoStart: boolean;
}

export interface HubSnapshot {
  hostIspIp: string | null;
  surfsharkAdapter: DetectedAdapter | null;
  adapters: DetectedAdapter[];
  slots: ProxySlotView[];
  locationsCount: number;
  locations: SurfsharkLocation[];
  gologinProfiles: GoLoginProfileSummary[];
  settings: SettingsView;
}

export interface CreateSlotPayload {
  name: string;
  port: number | null;
  mode: SlotMode;
  locationId: string | null;
  adapterHint: string | null;
  autoStart: boolean;
}
