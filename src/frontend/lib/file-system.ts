import * as FileSystem from 'expo-file-system/legacy';
import {Image as ExpoImage} from 'expo-image';

// @ts-expect-error Only null when on web https://github.com/expo/expo/issues/5558
export const DOCUMENT_DIRECTORY: string = FileSystem.documentDirectory;

export function convertFileUriToPosixPath(fileUri: string) {
  return fileUri.replace(/^file:\/\//, '');
}

/**
 * Returns the storage size of an image rendered using `expo-image`.
 * This is specific to Expo because their `Image` component uses the Expo file system abstraction for caching.
 *
 * @param imageURL The URL of the image.
 *
 * @returns The storage size of the image, in bytes.
 */
export async function getExpoImageStorageSize(
  imageURL: string,
): Promise<number | null> {
  let fileInfo: FileSystem.FileInfo;

  if (imageURL.startsWith('file://')) {
    fileInfo = await FileSystem.getInfoAsync(imageURL);
  } else {
    const cachePath = await ExpoImage.getCachePathAsync(imageURL);

    // null when the image isn't in expo-image's disk cache (served from memory,
    // not yet written, or evicted) — a benign miss, not an error.
    if (!cachePath) return null;

    fileInfo = await FileSystem.getInfoAsync(`file://${cachePath}`);
  }

  if (!fileInfo.exists) return null;

  return fileInfo.size;
}
