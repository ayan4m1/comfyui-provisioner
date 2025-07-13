export type Instance = {
  id: number;
};

export type Offer = {
  id: number;
  end_date: number;
  direct_port_count: number;
  disk_bw: number;
  dph_total: number;
  duration: number;
  geolocation: string;
  gpu_name: string;
  gpu_ram: number;
  inet_down: number;
  min_bid: number;
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
  name: string;
  description?: string;
  size: number;
  hash: string;
};

export type ProvisionOptions = {
  template?: string;
  minVram?: number;
};
