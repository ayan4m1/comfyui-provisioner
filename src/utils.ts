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

const getUrlSize = async (url: string): Promise<number> => {
  const res = await fetch(url);

  return parseInt(res.headers.get('Content-Length') ?? '0', 10);
};

const parseJsonInDir = async <T>(basePath: string): Promise<Map<string, T>> => {
  const result = new Map<string, T>();

  const paths = await readdir(basePath);
  const contents = await Promise.all(
    paths.map((path) => readFile(join(basePath, path), 'utf-8'))
  );
  const objects = contents.map(
    (content) => JSON.parse(content) as unknown as T
  );

  for (let i = 0; i < paths.length; i++) {
    result.set(paths[i], objects[i]);
  }

  return result;
};

const chooseTemplate = async (options: ProvisionOptions) => {
  try {
    const baseTemplatePath = join(getPackageJsonPath(), 'templates');

    let templatePath: string;

    if (!options.template) {
      const templateMap = await parseJsonInDir<Template>(baseTemplatePath);
      const chosenTemplate = await select<string>({
        message: 'Please choose a template to deploy.',
        choices: Array.from(
          templateMap.entries().map(([path, contents]) => ({
            name: contents.description
              ? `${contents.name} - ${contents.description}`
              : contents.name,
            value: path
          }))
        )
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

    console.log('Reading module JSON from ./modules');

    const moduleMap = await parseJsonInDir<Module>(baseModulePath);

    console.log('Fetching file sizes...');

    const moduleChoices = Array.from(
      await Promise.all(
        moduleMap.entries().map(async ([, module]) => {
          if (module.template !== template.name) {
            return [];
          }

          module.fileSizes = new Map<string, number>();
          module.totalSize = 0;

          for (const [, urls] of Object.entries(module.files)) {
            for (const url of urls) {
              const size = await getUrlSize(url);

              module.fileSizes.set(url, size);
              module.totalSize += size;
            }
          }

          return [
            {
              name: `${module.name} (${filesize(module.totalSize)})`,
              value: module
            }
          ];
        })
      )
    ).flat();

    if (!moduleChoices.length) {
      return [];
    }

    const chosenModules = await checkbox<Module>({
      loop: false,
      message: 'Please choose the modules you would like to include.',
      choices: moduleChoices
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

    if (template.fileTypes.length && modules.length) {
      // add all module deps together and then deduplicate
      const sumModule: ModuleDependencies = Object.fromEntries(
        template.fileTypes.map((val) => [val, []])
      );

      for (const module of modules) {
        for (const key of template.fileTypes) {
          sumModule[key] = uniq([
            ...sumModule[key],
            ...(module.files[key] ?? [])
          ]);
        }
      }

      for (const key of template.fileTypes) {
        if (!sumModule[key].length) {
          continue;
        }

        script = script.replace(
          `{{ ${key.toUpperCase()} }}`,
          formatBashArray(sumModule[key])
        );
      }
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
          '%-6s %-12s %-16s %8s %s',
          vramGb,
          offer.gpu_name,
          offer.geolocation,
          `${Math.floor(offer.inet_down)} Mbps`,
          chalk.bgHex(costHex)(`$${offer.search.totalHour.toFixed(3)}/hr`)
        ),
        value: offer
      };
    });
};

export const provision = async (options: ProvisionOptions): Promise<void> => {
  try {
    const templateInfo = await chooseTemplate(options);
    const modules = await chooseModules(templateInfo);
    const offers = await getOffers(options);

    const choice = await select<Offer>({
      message: 'Choose the instance you would like to request.',
      choices: formatOffers(options, offers),
      loop: false
    });

    let diskSizeBytes = templateInfo.size;

    if (modules.length) {
      const seenUrls: string[] = [];

      // do not count any URL more than once, sum up total added size
      for (const module of modules) {
        for (const [url, size] of module.fileSizes.entries()) {
          if (!seenUrls.includes(url)) {
            seenUrls.push(url);
            diskSizeBytes += size;
          }
        }
      }
    }

    // round up to nearest gigabyte
    diskSizeBytes /= 1e9;
    diskSizeBytes = Math.ceil(diskSizeBytes);
    diskSizeBytes *= 1e9;

    const hourlyDiskCost = choice.search.diskHour * (diskSizeBytes / 1e10); // convert to GB/hr
    const hourlyCost = `$${(choice.search.gpuCostPerHour + hourlyDiskCost).toFixed(3)}/hr`;
    const storageCost = `$${hourlyDiskCost.toFixed(3)}/hr`;
    const confirmMessage = `
Template: ${templateInfo.name}
Modules:
${modules.map((module) => `  * ${module.name} (${filesize(module.totalSize)})`).join('\n')}
Disk Size: ${filesize(diskSizeBytes)}

Are you SURE you want create the instance?

It will be automatically destroyed in ${formatDistanceToNow(fromUnixTime(choice.end_date))}.

You will be charged ${hourlyCost} while it is running and ${storageCost} while it is stopped!

It is YOUR responsibility to make sure that it has been stopped or destroyed correctly!
`;

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
      disk: diskSizeBytes / 1e9, // convert to GB
      target_state: 'running',
      cancel_unavail: true,
      vm: false
    };

    if (templateInfo.hash) {
      request.template_hash_id = templateInfo.hash;
    } else if (templateInfo.tag) {
      request.image = templateInfo.tag;
    }

    const deployResponse = await fetch(`${baseApiUrl}/asks/${choice.id}`, {
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
