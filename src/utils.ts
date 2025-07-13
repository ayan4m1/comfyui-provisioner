import { fileURLToPath } from 'url';
import { filesize } from 'filesize';
import { dirname, resolve } from 'path';
import { select } from '@inquirer/prompts';
import type { PackageJson } from '@npmcli/package-json';
import packageJsonModule from '@npmcli/package-json';

export type Offer = {
  id: number;
  direct_port_count: number;
  disk_bw: number;
  dph_total: number;
  duration: number;
  geolocation: string;
  gpu_name: string;
  gpu_ram: number;
  inet_down: number;
  min_bid: number;
  storage_cost: number;
};

export type Offers = {
  offers: Offer[];
};

export type ProvisionOptions = {
  script: string;
};

const getInstallDirectory = (): string =>
  dirname(fileURLToPath(import.meta.url));

const getPackageJsonPath = (): string => resolve(getInstallDirectory(), '..');

export const getPackageInfo = async (): Promise<PackageJson> =>
  (await packageJsonModule.load(getPackageJsonPath()))?.content;

export const provision = async (options: ProvisionOptions): Promise<void> => {
  try {
    const response = await fetch(
      'https://console.vast.ai/api/v0/search/asks/',
      {
        method: 'PUT',
        body: JSON.stringify({
          q: {
            type: 'on-demand',
            verified: { eq: true },
            rentable: { eq: true },
            rented: { eq: false },
            num_gpus: { eq: 1 },
            gpu_ram: { gte: 16384 },
            inet_down: { gte: 1000 },
            min_bid: { lte: 1 },
            limit: 10,
            order: [['dph_total', 'asc']]
          }
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        redirect: 'follow'
      }
    );
    const instances = JSON.parse(await response.text()) as unknown as Offers;

    console.table(
      instances.offers.map((offer) => ({
        id: offer.id,
        location: offer.geolocation,
        gpu: offer.gpu_name,
        vram: filesize(offer.gpu_ram * 1e6, { exponent: 3 }),
        net: `${Math.floor(offer.inet_down)} Mbps`,
        cost: `$${(offer.min_bid * 24).toFixed(2)}/day`
      }))
    );

    const choice = await select<string>({
      message: 'Choose the instance you would like to request.',
      choices: instances.offers.map((offer) => ({
        name: offer.id.toString(),
        value: offer.id.toString()
      }))
    });

    console.dir(
      `Deploying template ${options.script} to instance ${choice}...`
    );
  } catch (error) {
    console.error(error);
  }
};
