import type {
  BillingStatusResponse,
  DeviceListItem,
  LocalSuggestionActivity,
  PersonalMemory,
} from "@tab/contracts";
import type { User } from "../pages/shared.tsx";

export type DashboardData = {
  user: User;
  billing: BillingStatusResponse["data"];
  devices: readonly DeviceListItem[];
  memories: readonly PersonalMemory[];
  localSuggestionActivity: LocalSuggestionActivity;
};

export type DashboardSection = "overview" | "account" | "usage" | "devices" | "memories";
