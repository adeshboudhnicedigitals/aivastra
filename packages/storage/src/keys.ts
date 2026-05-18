export const keys = {
  inputGarment: (jobId: string) => `inputs/${jobId}/garment.jpg`,
  output: (jobId: string) => `outputs/${jobId}/result.png`,
  catalogItem: (typeSlug: string, id: string) => `catalog/${typeSlug}/${id}.jpg`,
  catalogThumb: (typeSlug: string, id: string) => `catalog/${typeSlug}/${id}.thumb.jpg`,
};
