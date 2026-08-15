// Shared File System Access API abstraction
// All operations work relative to a root directory handle
// Generic version — no file extension enforcement (each app handles its own)

export async function listFolders(rootHandle) {
  const folders = [];
  for await (const [name, handle] of rootHandle) {
    if (handle.kind === 'directory') {
      folders.push(name);
    }
  }
  return folders.sort((a, b) => a.localeCompare(b));
}

export async function listFiles(rootHandle, folderName, extension) {
  const files = [];
  let dirHandle = rootHandle;
  if (folderName) {
    dirHandle = await rootHandle.getDirectoryHandle(folderName);
  }
  for await (const [name, handle] of dirHandle) {
    if (handle.kind === 'file') {
      if (!extension || name.endsWith(extension)) {
        files.push(name);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export async function createFolder(rootHandle, folderName) {
  await rootHandle.getDirectoryHandle(folderName, { create: true });
}

export async function deleteFolder(rootHandle, folderName) {
  await rootHandle.removeEntry(folderName, { recursive: true });
}

export async function saveFile(rootHandle, folderName, fileName, content) {
  let dirHandle = rootHandle;
  if (folderName) {
    dirHandle = await rootHandle.getDirectoryHandle(folderName, { create: true });
  }
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function readFile(rootHandle, folderName, fileName) {
  let dirHandle = rootHandle;
  if (folderName) {
    dirHandle = await rootHandle.getDirectoryHandle(folderName);
  }
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return await file.text();
}

export async function deleteFile(rootHandle, folderName, fileName) {
  let dirHandle = rootHandle;
  if (folderName) {
    dirHandle = await rootHandle.getDirectoryHandle(folderName);
  }
  await dirHandle.removeEntry(fileName);
}

export async function renameFile(rootHandle, folderName, oldName, newName) {
  const content = await readFile(rootHandle, folderName, oldName);
  await saveFile(rootHandle, folderName, newName, content);
  await deleteFile(rootHandle, folderName, oldName);
}

export async function getNestedDirectoryHandle(rootHandle, pathParts) {
  let current = rootHandle;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}
