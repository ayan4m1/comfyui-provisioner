import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { filesize } from 'filesize';
import { sprintf } from 'sprintf-js';
import { readdir, readFile } from 'fs/promises';
import { ExitPromptError } from '@inquirer/core';
import { confirm, select } from '@inquirer/prompts';
// eslint-disable-next-line import-x/no-unresolved
import packageJsonModule from '@npmcli/package-json';
import type { PackageJson } from '@npmcli/package-json';
import { dirname, join, resolve } from 'path';
// eslint-disable-next-line import-x/no-unresolved
import { formatDistanceToNow, fromUnixTime } from 'date-fns';

import {
  Instance,
  Offer,
  Offers,
  ProvisionOptions,
  Template
} from './types.js';

const baseApiUrl = 'https://console.vast.ai/api/v0';
const rtx5000Regex = /rtx\s*5[0-9]{3}/i;

const getInstallDirectory = (): string =>
  dirname(fileURLToPath(import.meta.url));

const getPackageJsonPath = (): string => resolve(getInstallDirectory(), '..');

export const getPackageInfo = async (): Promise<PackageJson> =>
  (await packageJsonModule.load(getPackageJsonPath()))?.content;

const chooseTemplate = async (options: ProvisionOptions) => {
  const baseTemplatePath = join(getPackageJsonPath(), 'templates');

  let templatePath: string;

  if (!options.template) {
    const templatePaths = await readdir(baseTemplatePath);
    const templateFiles = await Promise.all(
      templatePaths.map((path) =>
        readFile(join(baseTemplatePath, path), 'utf-8')
      )
    );
    const chosenTemplate = await select<string>({
      message: 'Please choose a template to deploy',
      choices: templatePaths.map((path, index) => {
        const contents = JSON.parse(
          templateFiles[index]
        ) as unknown as Template;

        return {
          name: contents.description
            ? `${contents.name} - ${contents.description}`
            : contents.name,
          value: path
        };
      })
    });

    templatePath = join(baseTemplatePath, chosenTemplate);
  } else {
    templatePath = join(baseTemplatePath, `${options.template}.json`);
  }

  return templatePath;
};

const getOffers = async (options: ProvisionOptions) => {
  const result: Offer[] = [];

  try {
    const response = await fetch(`${baseApiUrl}/search/asks/`, {
      method: 'PUT',
      body: JSON.stringify({
        q: {
          type: 'on-demand',
          verified: { eq: true },
          rentable: { eq: true },
          rented: { eq: false },
          num_gpus: { eq: 1 },
          gpu_ram: { gte: options.minVram * 1024 },
          inet_down: { gte: 1000 },
          direct_port_count: { lte: options.maxPorts },
          limit: 25,
          order: [
            ['dph_total', 'asc'],
            ['inet_down', 'desc']
          ]
        }
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      redirect: 'follow'
    });
    const { offers } = JSON.parse(await response.text()) as unknown as Offers;

    result.push(...offers);
  } catch (error) {
    console.error('Error occurred during Vast.ai instance search!');
    console.error(error);
  }

  return result;
};

export const provision = async (options: ProvisionOptions): Promise<void> => {
  // eslint-disable-next-line prefer-const
  let rentedInstance: Instance = null;

  try {
    const templatePath = await chooseTemplate(options);

    if (!existsSync(templatePath)) {
      return console.error(`Unable to find template at ${templatePath}!`);
    }

    const templateInfo = JSON.parse(
      await readFile(templatePath, 'utf-8')
    ) as unknown as Template;

    const offers = await getOffers(options);
    const choice = await select<number>({
      message: 'Choose the instance you would like to request.',
      choices: offers
        .filter((offer) => !rtx5000Regex.test(offer.gpu_name))
        .filter((offer) => offer.search.totalHour <= options.maxHourlyCost)
        .map((offer) => ({
          name: sprintf(
            '%-16s %-12s %s %8s %s',
            offer.geolocation,
            offer.gpu_name,
            filesize(offer.gpu_ram * 1e6, {
              exponent: 3,
              round: 0,
              roundingMethod: 'floor'
            }),
            `${Math.floor(offer.inet_down)} Mbps`,
            `$${offer.search.totalHour.toFixed(3)}/hr`
          ),
          value: offer.id
        })),
      loop: false
    });
    const chosen = offers.find((offer) => offer.id === choice);
    const hourlyDiskCost = chosen.search.diskHour * (templateInfo.size / 1e10);
    const hourlyCost = `$${(chosen.search.gpuCostPerHour + hourlyDiskCost).toFixed(3)}/hr`;
    const storageCost = `$${hourlyDiskCost.toFixed(3)}/hr`;
    const confirmed = await confirm({
      message: `Are you SURE you want create the instance?\n\nIt will be automatically destroyed in ${formatDistanceToNow(fromUnixTime(chosen.end_date))}.\n\nYou will be charged ${hourlyCost} while it is running and ${storageCost} while it is stopped!\n\nIt is YOUR responsibility to make sure that it has been stopped or destroyed correctly.\n`,
      default: false
    });

    if (!confirmed) {
      return console.log('Exiting because user declined to deploy.');
    }

    console.dir(
      `Deploying template ${options.template} with hash ${templateInfo.hash} to instance ${choice}...`
    );

    const deployResponse = await fetch(`${baseApiUrl}/asks/${chosen.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_hash_id: templateInfo.hash,
        disk: templateInfo.size / 1e9,
        target_state: 'running',
        cancel_unavail: true,
        vm: false
      })
    });
    const result = JSON.parse(await deployResponse.text());

    console.dir(result);
  } catch (error: unknown) {
    if (error instanceof ExitPromptError) {
      console.log('User requested cancellation of the provisioning process...');
    } else {
      console.error(error);
    }
  } finally {
    if (rentedInstance) {
      // todo: destroy rented instance
    }
  }
};
