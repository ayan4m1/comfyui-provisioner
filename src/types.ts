export type Instance = {
  id: number;
};

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

export type Template = {
  description?: string;
  environment?: Record<string, string>;
  hash: string;
  name: string;
  size: number;
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
