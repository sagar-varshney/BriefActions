"""Verified, input-only imports from bundled synthetic evaluation corpora."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIBRARY = {
    'starter-v1': ('Starter corpus', ROOT/'evaluation', 'corpus_manifest.json'),
    'revision-v1': ('Revision and cancellation corpus', ROOT/'evaluation'/'revision-v1', 'manifest.json'),
}


def corpus_inputs(corpus_id, split='all'):
    if corpus_id not in LIBRARY or split not in ('all', 'dev', 'test'):
        raise ValueError('Choose a bundled corpus and dev, test, or all splits')
    _, root, manifest_name = LIBRARY[corpus_id]
    manifest = json.loads((root/manifest_name).read_text())
    rows = []
    for part in ('dev', 'test') if split == 'all' else (split,):
        raw = (root/f'{part}.jsonl').read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        expected = manifest['splits'][part]
        if digest != expected['sha256']:
            raise ValueError('Bundled corpus fingerprint changed; review it before importing')
        parsed = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
        if len(parsed) != expected['transcripts'] or len({r['id'] for r in parsed}) != len(parsed):
            raise ValueError('Bundled corpus case count or identifiers changed')
        for row in parsed:
            if row['split'] != part:
                raise ValueError('Bundled corpus split mismatch')
            # Deliberately whitelist input fields. Gold items and rationale never enter SQLite.
            rows.append({'transcript':row['transcript'], 'reference_date':row['reference_date'],
                'origin':{'corpus_id':corpus_id, 'case_id':row['id'], 'split':part,
                          'dataset_sha256':digest, 'provenance':manifest['provenance']}})
    return rows


def catalogue():
    return [{'id':key, 'name':name,
             'splits':{part:{'cases':data['transcripts'], 'sha256':data['sha256']}
                       for part, data in json.loads((root/manifest_name).read_text())['splits'].items()}}
            for key, (name,root,manifest_name) in LIBRARY.items()]
