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
  CreateInstanceResponse,
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
            ['inet_down', 'asc']
          ]
        }
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      redirect: 'follow'
    });
    const { offers } = (await response.json()) as unknown as Offers;

    result.push(...offers);
  } catch (error) {
    console.error('Error occurred during Vast.ai instance search!');
    console.error(error);
  }

  return result;
};

const formatBashArray = (items: string[]) =>
  items ? items.map((item) => `    "${item}"`).join('\n') : '';

const getScriptUrl = async (template: Template) => {
  try {
    const scriptPath = join(getPackageJsonPath(), 'scripts', template.script);
    if (!existsSync(scriptPath)) {
      console.error(`Could not find script at ${scriptPath}!`);
      return '';
    }

    const rawScript = await readFile(scriptPath, 'utf-8');
    const {
      apt_packages,
      pip_packages,
      nodes,
      workflows,
      clip_models,
      checkpoint_models,
      unet_models,
      lora_models,
      vae_models,
      esrgan_models,
      controlnet_models,
      text_encoder_models,
      diffusion_models
    } = template.provision;

    const finalScript = rawScript
      .replace('{{ APT_PACKAGES }}', formatBashArray(apt_packages))
      .replace('{{ PIP_PACKAGES }}', formatBashArray(pip_packages))
      .replace('{{ NODES }}', formatBashArray(nodes))
      .replace('{{ WORKFLOWS }}', formatBashArray(workflows))
      .replace('{{ CLIP_MODELS }}', formatBashArray(clip_models))
      .replace('{{ CHECKPOINT_MODELS }}', formatBashArray(checkpoint_models))
      .replace('{{ UNET_MODELS }}', formatBashArray(unet_models))
      .replace('{{ LORA_MODELS }}', formatBashArray(lora_models))
      .replace('{{ VAE_MODELS }}', formatBashArray(vae_models))
      .replace('{{ ESRGAN_MODELS }}', formatBashArray(esrgan_models))
      .replace('{{ CONTROLNET_MODELS }}', formatBashArray(controlnet_models))
      .replace(
        '{{ TEXT_ENCODER_MODELS }}',
        formatBashArray(text_encoder_models)
      )
      .replace('{{ DIFFUSION_MODELS }}', formatBashArray(diffusion_models));

    const postData = new FormData();

    postData.append('api_dev_key', process.env.PASTEBIN_API_KEY);
    postData.append('api_option', 'paste');
    postData.append('api_paste_code', finalScript);
    postData.append('api_paste_private', '1');
    postData.append('api_paste_format', 'bash');
    postData.append('api_paste_name', 'provision.sh');
    postData.append('api_paste_expire_date', '10M');

    const result = await fetch('https://pastebin.com/api/api_post.php', {
      method: 'POST',
      body: postData
    });
    const url = await result.text();

    return url.replace('pastebin.com/', 'pastebin.com/raw/');
  } catch (error) {
    console.error(error);
    return '';
  }
};

export const provision = async (options: ProvisionOptions): Promise<void> => {
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
    const hourlyDiskCost = chosen.search.diskHour * (templateInfo.size / 1e10); // in GB/hr
    const hourlyCost = `$${(chosen.search.gpuCostPerHour + hourlyDiskCost).toFixed(3)}/hr`;
    const storageCost = `$${hourlyDiskCost.toFixed(3)}/hr`;
    const confirmed = await confirm({
      message: `Are you SURE you want create the instance?\n\nIt will be automatically destroyed in ${formatDistanceToNow(fromUnixTime(chosen.end_date))}.\n\nYou will be charged ${hourlyCost} while it is running and ${storageCost} while it is stopped!\n\nIt is YOUR responsibility to make sure that it has been stopped or destroyed correctly.\n`,
      default: false
    });

    if (!confirmed) {
      return console.log('Exiting because user declined to deploy.');
    }

    console.log(
      `Deploying ${templateInfo.name} (template ${templateInfo.hash}) to instance ${choice}...`
    );

    const environmentVars: Record<string, string> = {};

    if (templateInfo.provision) {
      environmentVars.PROVISIONER_SCRIPT = await getScriptUrl(templateInfo);
    }

    const deployResponse = await fetch(`${baseApiUrl}/asks/${chosen.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.VAST_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_hash_id: templateInfo.hash,
        extra_env: environmentVars,
        disk: templateInfo.size / 1e9, // in GB
        target_state: 'running',
        cancel_unavail: true,
        vm: false
      })
    });
    const result =
      (await deployResponse.json()) as unknown as CreateInstanceResponse;

    if (result.success) {
      console.log(`Instance ${result.new_contract} created!`);
    } else {
      console.log('Failed to create instance!');
    }

    console.log('\nPress Ctrl-C when you are ready to destroy the instance...');
    process.stdin.resume();
    process.on('SIGINT', async () => {
      if (!result.new_contract) {
        console.error('No instance to destroy! Exiting...');
        return process.exit(0);
      }

      try {
        await fetch(`${baseApiUrl}/instances/${result.new_contract}`, {
          headers: {
            Authorization: `Bearer ${process.env.VAST_API_KEY}`,
            'Content-Type': 'application/json'
          },
          method: 'DELETE'
        });

        console.log(`Instance ${result.new_contract} destroyed! Exiting...`);
        process.exit(0);
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
    });
  } catch (error: unknown) {
    if (error instanceof ExitPromptError) {
      console.log('User requested cancellation of the provisioning process...');
    } else {
      console.error(error);
    }
  }
};
