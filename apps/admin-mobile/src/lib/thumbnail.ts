import * as ImageManipulator from 'expo-image-manipulator';

export async function makeThumbnail(uri: string, maxSize = 512): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: maxSize } }], {
    compress: 0.78,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}
