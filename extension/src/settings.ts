import {
  CONFIG_ENABLED,
  CONFIG_SECTION,
  CONFIG_WALK_TO_CENTER,
} from "./types";

export type KunPetSettings = {
  enabled: boolean;
  walkToCenter: boolean;
};

type ConfigLike = {
  get(key: string, defaultValue: boolean): boolean;
};

export function readKunPetSettings(
  getConfig: (section: string) => ConfigLike
): KunPetSettings {
  const cfg = getConfig(CONFIG_SECTION);
  return {
    enabled: cfg.get(CONFIG_ENABLED, true),
    walkToCenter: cfg.get(CONFIG_WALK_TO_CENTER, true),
  };
}
