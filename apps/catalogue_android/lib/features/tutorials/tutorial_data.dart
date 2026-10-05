/// The tutorial library. The web app has no API for this either - its
/// Tutorials page ships this same list in its source
/// (`catalogues-web/src/app/(app)/tutorials/page.tsx`) - so it is mirrored
/// here; keep the two in step when tutorials are added.
class Tutorial {
  const Tutorial({
    required this.id,
    required this.title,
    required this.tag,
    required this.category,
    required this.duration,
    required this.youtubeUrl,
  });

  final String id;
  final String title;

  /// Small pill on the card.
  final String tag;

  /// Which filter tab it belongs to.
  final String category;
  final String duration;
  final String youtubeUrl;

  /// The YouTube video id (`youtu.be/<id>` or `watch?v=<id>`).
  String get videoId {
    final uri = Uri.tryParse(youtubeUrl);
    if (uri == null) return youtubeUrl;
    if (uri.host == 'youtu.be') {
      return uri.pathSegments.isEmpty ? '' : uri.pathSegments.first;
    }
    return uri.queryParameters['v'] ?? '';
  }

  /// `mqdefault` is YouTube's 320x180 frame: true 16:9 (`hqdefault` is 4:3
  /// with black bars baked in) and a fraction of the bytes.
  String get thumbnailUrl =>
      'https://img.youtube.com/vi/$videoId/mqdefault.jpg';
}

const tutorialTabs = [
  'All Tutorials',
  'Get Started',
  'AI Catalogue Studio',
  'AI Virtual Try-On',
  'Best Practices',
];

const tutorials = [
  Tutorial(
    id: 't1',
    title: "Catalogue - Women's Full Sleeve Shirt",
    tag: 'Catalogue',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/z1w3tRf0y-o?si=jxz2oCjrdFoG-Oo8',
  ),
  Tutorial(
    id: 't2',
    title: "Catalogue - Women's Half Sleeve Shirt",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/j9-MLutMaB0?si=I0BkFIVRMuedAY-o',
  ),
  Tutorial(
    id: 't3',
    title: "Catalogue - Women's Half Sleeve T-shirt",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/OvVHS8NRgJA?si=1fQqQiF3vPo8GfC_',
  ),
  Tutorial(
    id: 't4',
    title: "Catalogue - Women's Full Sleeve Tshirt",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/E0XD7TXgdlg?si=V3X2CAIcqRoJyHUi',
  ),
  Tutorial(
    id: 't5',
    title: "Catalogue - Women's Top",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/vaXQ0nGl3bg?si=6ybIY8Q8CJO64lw0',
  ),
  Tutorial(
    id: 't6',
    title: "Catalogue - Women's Crop Top",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/zZQ-CM3iwIU?si=hrAGigj7fRhUtA8n',
  ),
  Tutorial(
    id: 't7',
    title: "Catalogue - Women's Hoodie",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/czK4DzqrN-4?si=4VyawtUruuZfopFA',
  ),
  Tutorial(
    id: 't8',
    title: "Catalogue - Women's Jacket",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/xGZOseG5Q90?si=yQuSTF91gXRofN2O',
  ),
  Tutorial(
    id: 't9',
    title: "Catalogue - Women's Mini Frock",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/ozhtfeQcQDU?si=rGEksEGIz2XRxVEG',
  ),
  Tutorial(
    id: 't10',
    title: "Catalogue - Women's Long Frock",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/KzCvKENy-qI?si=0Zj3LGBtT7hCy18x',
  ),
  Tutorial(
    id: 't11',
    title: "Catalogue - Women's Kurti",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/JGnymrFSJI8?si=aHlT1cPFsD9Lb6ke',
  ),
  Tutorial(
    id: 't12',
    title: "Catalogue - Women's Kurti & Pyjama",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/9-fE1n3Hxa4?si=GBdI5jJirvqUh-yk',
  ),
  Tutorial(
    id: 't13',
    title: "Catalogue - Women's Sweatshirt",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/ciE-fJqNwWs?si=iitOVVh8kNFUS1qJ',
  ),
  Tutorial(
    id: 't14',
    title: "Catalogue - Women's Cocktail",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/tkjdm-C1fJo?si=tdwvM4mZHn5E0bPj',
  ),
  Tutorial(
    id: 't15',
    title: "Catalogue - Women's Jumpsuit",
    tag: 'Try-On',
    category: 'AI Catalogue Studio',
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/q09adqU1gg0?si=ZvJMEL8lRjPMY1Ij',
  ),
];
