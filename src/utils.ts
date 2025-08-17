import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { filesize } from 'filesize';
import { sprintf } from 'sprintf-js';
import { dirname, join, resolve } from 'path';
import { readdir, readFile } from 'fs/promises';
import { ExitPromptError } from '@inquirer/core';
import packageJsonModule from '@npmcli/package-json';
import type { PackageJson } from '@npmcli/package-json';
import { formatDistanceToNow, fromUnixTime } from 'date-fns';
import { checkbox, confirm, select } from '@inquirer/prompts';

import {
  CreateInstanceResponse,
  Module,
  Offer,
  Offers,
  ModuleDependency,
  ProvisionOptions,
  RunType,
  Template,
  ModuleDependencies
} from './types.js';
import uniq from 'lodash.uniq';
import chalk from 'chalk';
import { interpolateRgb } from 'd3-interpolate';

const pastebinApiUrl = 'https://pastebin.com/api/api_post.php';
const baseApiUrl = 'https://console.vast.ai/api/v0';
const rtx5000Regex = /rtx\s*5[0-9]{3}/i;

const getInstallDirectory = (): string =>
  dirname(fileURLToPath(import.meta.url));

const getPackageJsonPath = (): string => resolve(getInstallDirectory(), '..');

const formatBashArray = (items: string[]) =>
  items ? items.map((item) => `    "${item}"`).join('\n') : '';

export const getPackageInfo = async (): Promise<PackageJson> =>
  (await packageJsonModule.load(getPackageJsonPath()))?.content;

const chooseTemplate = async (options: ProvisionOptions) => {
  try {
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
        message: 'Please choose a template to deploy.',
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

    if (!existsSync(templatePath)) {
      throw new Error(`Unable to find template at ${templatePath}!`);
    }

    return JSON.parse(
      await readFile(templatePath, 'utf-8')
    ) as unknown as Template;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

const chooseModules = async (template: Template) => {
  try {
    const baseModulePath = join(getPackageJsonPath(), 'modules');
    const modulePaths = await readdir(baseModulePath);
    const moduleFiles = await Promise.all(
      modulePaths.map((path) => readFile(join(baseModulePath, path), 'utf-8'))
    );
    const chosenModules = await checkbox<Module>({
      loop: false,
      message: 'Please choose the modules you would like to include.',
      choices: modulePaths.flatMap((_, index) => {
        const contents = JSON.parse(moduleFiles[index]) as unknown as Module;

        if (!contents.templates.includes(template.name)) {
          return [];
        }

        return [
          {
            name: contents.name,
            value: contents
          }
        ];
      })
    });

    return chosenModules;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

const getOffers = async (options: ProvisionOptions) => {
  try {
    const response = await fetch(`${baseApiUrl}/search/asks`, {
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

    return offers;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

const getScriptUrl = async (template: Template, modules: Module[]) => {
  try {
    const scriptPath = join(getPackageJsonPath(), 'scripts', template.script);
    if (!existsSync(scriptPath)) {
      throw new Error(`Could not find script at ${scriptPath}!`);
    }

    let script = await readFile(scriptPath, 'utf-8');

    if (modules.length) {
      // add all module deps together and then deduplicate
      const sumModule: ModuleDependencies = Object.fromEntries(
        Object.entries(ModuleDependency).map(([, val]) => [val as string, []])
      );

      for (const module of modules) {
        for (const key of Object.values(ModuleDependency)) {
          sumModule[key] = uniq([...sumModule[key], ...(module[key] ?? [])]);
        }
      }

      // substitute lists into Bash script
      const {
        apt_packages,
        pip_packages,
        nodes,
        workflows,
        clip_models,
        clip_vision_models,
        checkpoint_models,
        unet_models,
        lora_models,
        vae_models,
        esrgan_models,
        controlnet_models,
        text_encoder_models,
        diffusion_models
      } = sumModule;

      script = script
        .replace('{{ APT_PACKAGES }}', formatBashArray(apt_packages))
        .replace('{{ PIP_PACKAGES }}', formatBashArray(pip_packages))
        .replace('{{ NODES }}', formatBashArray(nodes))
        .replace('{{ WORKFLOWS }}', formatBashArray(workflows))
        .replace('{{ CLIP_MODELS }}', formatBashArray(clip_models))
        .replace(
          '{{ CLIP_VISION_MODELS }}',
          formatBashArray(clip_vision_models)
        )
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
    }

    const postData = new FormData();

    postData.append('api_dev_key', process.env.PASTEBIN_API_KEY);
    postData.append('api_option', 'paste');
    postData.append('api_paste_code', script);
    postData.append('api_paste_private', '1');
    postData.append('api_paste_format', 'bash');
    postData.append('api_paste_name', 'provision.sh');
    postData.append('api_paste_expire_date', '10M');

    const result = await fetch(pastebinApiUrl, {
      method: 'POST',
      body: postData
    });
    const url = await result.text();

    return url.replace('pastebin.com/', 'pastebin.com/raw/');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

const formatOffers = (options: ProvisionOptions, offers: Offer[]) => {
  const minPrice = offers.reduce(
    (prev, curr) =>
      prev < curr.search.totalHour ? prev : curr.search.totalHour,
    100
  );
  const maxPrice = offers.reduce(
    (prev, curr) =>
      prev > curr.search.totalHour ? prev : curr.search.totalHour,
    0
  );

  return offers
    .filter((offer) => !rtx5000Regex.test(offer.gpu_name))
    .filter((offer) => offer.search.totalHour <= options.maxHourlyCost)
    .map((offer) => {
      // convert GB to bytes, then format as rounded GB
      const vramGb = filesize(offer.gpu_ram * 1e6, {
        exponent: 3,
        round: 0,
        roundingMethod: 'floor'
      });
      // interpolate relative cost from cheapest to most expensive
      const costRgb = interpolateRgb(
        '#00ff00',
        '#ff0000'
      )((offer.search.totalHour - minPrice) / (maxPrice - minPrice))
        .replace('rgb(', '')
        .replace(')', '')
        .split(',')
        .map((val) => parseInt(val, 10));
      const costHex = `#${((1 << 24) + (costRgb[0] << 16) + (costRgb[1] << 8) + costRgb[2]).toString(16).slice(1)}`;

      return {
        name: sprintf(
          '%-16s %-12s %s %8s %s',
          offer.geolocation,
          offer.gpu_name,
          vramGb,
          `${Math.floor(offer.inet_down)} Mbps`,
          chalk.hex(costHex)(`$${offer.search.totalHour.toFixed(3)}/hr`)
        ),
        value: offer.id
      };
    });
};

export const provision = async (options: ProvisionOptions): Promise<void> => {
  try {
    const templateInfo = await chooseTemplate(options);
    const modules = await chooseModules(templateInfo);
    const offers = await getOffers(options);

    const choice = await select<number>({
      message: 'Choose the instance you would like to request.',
      choices: formatOffers(options, offers),
      loop: false
    });
    const chosen = offers.find((offer) => offer.id === choice);
    const hourlyDiskCost = chosen.search.diskHour * (templateInfo.size / 1e10); // convert to GB/hr
    const hourlyCost = `$${(chosen.search.gpuCostPerHour + hourlyDiskCost).toFixed(3)}/hr`;
    const storageCost = `$${hourlyDiskCost.toFixed(3)}/hr`;
    const confirmMessage = `Are you SURE you want create the instance?\n\nIt will be automatically destroyed in ${formatDistanceToNow(fromUnixTime(chosen.end_date))}.\n\nYou will be charged ${hourlyCost} while it is running and ${storageCost} while it is stopped!\n\nIt is YOUR responsibility to make sure that it has been stopped or destroyed correctly.\n`;

    const confirmed = await confirm({
      message: confirmMessage,
      default: false
    });

    if (!confirmed) {
      return console.log('Exiting because user declined to deploy.');
    }

    console.log(`Deploying ${templateInfo.name} to instance ${choice}...`);

    const environmentVars: Record<string, string> = {
      ...templateInfo.environment
    };

    if (templateInfo.script) {
      environmentVars.PROVISIONER_SCRIPT = await getScriptUrl(
        templateInfo,
        modules
      );
    }

    const request: Record<string, unknown> = {
      extra_env: environmentVars,
      runtype: templateInfo.runType ?? RunType.Jupyter,
      disk: templateInfo.size / 1e9, // convert to GB
      target_state: 'running',
      cancel_unavail: true,
      vm: false
    };

    if (templateInfo.hash) {
      request.template_hash_id = templateInfo.hash;
    } else if (templateInfo.tag) {
      request.image = templateInfo.tag;
    }

    const deployResponse = await fetch(`${baseApiUrl}/asks/${chosen.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.VAST_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const result =
      (await deployResponse.json()) as unknown as CreateInstanceResponse;

    if (result.success) {
      console.log(`Instance ${result.new_contract} created!`);
    } else {
      console.log('Failed to create instance!');
    }

    console.log(
      '\nPress Ctrl-D to stop the instance, or Ctrl-C to destroy it...'
    );
    process.stdin.resume();
    process.on('SIGQUIT', async () => {
      if (!result.new_contract) {
        console.error('No instance to stop! Exiting...');
        return process.exit(0);
      }

      try {
        await fetch(`${baseApiUrl}/instances/${result.new_contract}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.VAST_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            state: 'stopped'
          })
        });

        console.log(`Instance ${result.new_contract} stopped! Exiting...`);
        process.exit(0);
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
    });
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
