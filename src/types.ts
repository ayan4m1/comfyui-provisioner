export type Offer = {
  direct_port_count: number;
  disk_bw: number;
  dlperf_per_dphtotal: number;
  end_date: number;
  geolocation: string;
  gpu_name: string;
  gpu_ram: number;
  id: number;
  inet_down: number;
  search: {
    gpuCostPerHour: number;
    diskHour: number;
    totalHour: number;
  };
};

export type Offers = {
  offers: Offer[];
};

export enum ProvisionKeys {
  AptPackages = 'apt_packages',
  PipPackages = 'pip_packages',
  Nodes = 'nodes',
  Workflows = 'workflows',
  ClipModels = 'clip_models',
  CheckpointModels = 'checkpoint_models',
  UnetModels = 'unet_models',
  LoraModels = 'lora_models',
  VaeModels = 'vae_models',
  EsrganModels = 'esrgan_models',
  ControlNetModels = 'controlnet_models',
  TextEncoderModels = 'text_encoder_models',
  DiffusionModels = 'diffusion_models'
}

export type Template = {
  description?: string;
  hash: string;
  name: string;
  size: number;
  script?: string;
  provision?: Partial<Record<ProvisionKeys, string[]>>;
};

export type CreateInstanceResponse = {
  new_contract?: number;
  success: boolean;
};

export type ProvisionOptions = {
  maxHourlyCost?: number;
  maxPorts?: number;
  minVram?: number;
  template?: string;
};
