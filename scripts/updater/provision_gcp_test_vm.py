#!/usr/bin/env python3
"""Provision one small, isolated, time-limited Omaha qualification VM."""

import argparse
import json
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--zone', default='us-west1-b')
    parser.add_argument('--state', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', args.project):
        parser.error('Invalid project ID')
    if not re.fullmatch(r'[a-z]+-[a-z]+[0-9]-[a-z]', args.zone):
        parser.error('Invalid zone')
    region = args.zone.rsplit('-', 1)[0]
    prefix = 'bo-omaha-test'
    network, subnet = prefix + '-net', prefix + '-subnet'

    def run(*command):
        return subprocess.run(['gcloud', *command, '--project=' + args.project, '--quiet'],
                              text=True, capture_output=True)

    def checked(*command):
        result = run(*command)
        if result.returncode:
            raise RuntimeError(result.stderr[-3000:])
        return json.loads(result.stdout) if result.stdout.strip() else None

    billing = checked('billing', 'projects', 'describe', args.project, '--format=json')
    if not billing.get('billingEnabled'):
        raise RuntimeError('Project billing must be explicitly configured first')
    plan = {'project': args.project, 'zone': args.zone, 'name': prefix,
            'machine_type': 'e2-micro', 'boot_disk_gib': 10, 'boot_disk_type': 'pd-standard',
            'network': network, 'subnet': subnet, 'ssh': 'IAP only',
            'service_account': None, 'automatic_deletion_after_hours': 4}
    print(json.dumps(plan, indent=2), flush=True)

    def ensure(describe, create, predicate):
        existing = run(*describe, '--format=json')
        if existing.returncode == 0:
            value = json.loads(existing.stdout)
            if not predicate(value):
                raise RuntimeError('Existing resource differs from the isolated test plan')
            return value
        if 'not found' not in existing.stderr.lower():
            raise RuntimeError(existing.stderr[-2000:])
        return checked(*create, '--format=json')

    ensure(['compute', 'networks', 'describe', network],
           ['compute', 'networks', 'create', network, '--subnet-mode=custom',
            '--description=Isolated Browser Operator Omaha qualification network'],
           lambda value: value.get('description') == 'Isolated Browser Operator Omaha qualification network')
    ensure(['compute', 'networks', 'subnets', 'describe', subnet, '--region=' + region],
           ['compute', 'networks', 'subnets', 'create', subnet, '--region=' + region,
            '--network=' + network, '--range=10.159.0.0/28'],
           lambda value: value['network'].endswith('/' + network) and value['ipCidrRange'] == '10.159.0.0/28')
    for suffix, source, allow in [('web', '0.0.0.0/0', 'tcp:80,tcp:443'),
                                  ('iap-ssh', '35.235.240.0/20', 'tcp:22')]:
        name = prefix + '-' + suffix
        ensure(['compute', 'firewall-rules', 'describe', name],
               ['compute', 'firewall-rules', 'create', name, '--network=' + network,
                '--direction=INGRESS', '--source-ranges=' + source,
                '--target-tags=' + prefix, '--allow=' + allow],
               lambda value, source=source: value['network'].endswith('/' + network)
               and value.get('sourceRanges') == [source] and value.get('targetTags') == [prefix])
    ensure(['compute', 'instances', 'describe', prefix, '--zone=' + args.zone],
           ['compute', 'instances', 'create', prefix, '--zone=' + args.zone,
            '--machine-type=e2-micro', '--image-family=debian-13', '--image-project=debian-cloud',
            '--subnet=' + subnet, '--tags=' + prefix,
            '--boot-disk-size=10GB', '--boot-disk-type=pd-standard', '--boot-disk-auto-delete',
            '--no-service-account', '--no-scopes', '--shielded-secure-boot',
            '--no-restart-on-failure', '--max-run-duration=4h', '--instance-termination-action=DELETE',
            '--metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE',
            '--labels=app=browser-operator,purpose=omaha-qualification,managed-by=browser-operator-test'],
           lambda value: value.get('labels', {}).get('purpose') == 'omaha-qualification'
           and value['machineType'].endswith('/e2-micro'))
    vm = checked('compute', 'instances', 'describe', prefix, '--zone=' + args.zone, '--format=json')
    plan.update({'status': vm['status'], 'external_ip': vm['networkInterfaces'][0]['accessConfigs'][0]['natIP'],
                 'creation_timestamp': vm['creationTimestamp'], 'scheduling': vm['scheduling']})
    args.state.parent.mkdir(parents=True, exist_ok=True)
    args.state.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps(plan, indent=2), flush=True)


if __name__ == '__main__':
    main()
