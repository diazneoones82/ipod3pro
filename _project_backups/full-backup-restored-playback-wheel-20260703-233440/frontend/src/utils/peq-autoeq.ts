const OWNER = 'kaurav99';
const REPO = 'PEQ-AutoEQ';
const REF = 'main';
const PEQ_PARENT = 'PEQ';
const PEQ_FOLDER = 'Updated PEQ Folderwise 2025 June';
const PEQ_ROOT = `${PEQ_PARENT}/${PEQ_FOLDER}`;

type GitHubContent = {
  name: string;
  path: string;
  type: 'dir' | 'file';
  git_url?: string;
};

type GitHubTreeItem = {
  path: string;
  type: 'tree' | 'blob';
  size?: number;
};

type GitHubTree = {
  tree: GitHubTreeItem[];
  truncated?: boolean;
};

export type PeqAutoEqProfile = {
  id: string;
  name: string;
  source: string;
  kind: string;
  path: string;
  size: number;
  downloadUrl: string;
};

function rawUrl(path: string): string {
  const encoded = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${encoded}`;
}

function profileName(path: string): string {
  const filename = path.split('/').pop() ?? path;
  return filename.replace(/\.peq$/i, '');
}

export async function listPeqAutoEqProfiles(): Promise<PeqAutoEqProfile[]> {
  const contentsUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PEQ_PARENT}?ref=${REF}`;
  const contentsRes = await fetch(contentsUrl);
  if (!contentsRes.ok) throw new Error(`PEQ contents HTTP ${contentsRes.status}`);
  const contents = await contentsRes.json() as GitHubContent[];
  const updatedFolder = Array.isArray(contents)
    ? contents.find((item) => item.type === 'dir' && item.name === PEQ_FOLDER && item.git_url)
    : null;
  if (!updatedFolder?.git_url) throw new Error('PEQ folder missing');

  const treeRes = await fetch(`${updatedFolder.git_url}?recursive=1`);
  if (!treeRes.ok) throw new Error(`PEQ tree HTTP ${treeRes.status}`);
  const tree = await treeRes.json() as GitHubTree;
  if (tree.truncated) throw new Error('PEQ tree truncated');

  return tree.tree
    .filter((item) => item.type === 'blob' && item.path.toLowerCase().endsWith('.peq'))
    .map((item) => {
      const parts = item.path.split('/');
      return {
        id: item.path,
        name: profileName(item.path),
        source: parts[0] ?? 'PEQ-AutoEQ',
        kind: parts[1] ?? 'headphone',
        path: item.path,
        size: item.size ?? 0,
        downloadUrl: rawUrl(`${PEQ_ROOT}/${item.path}`),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
