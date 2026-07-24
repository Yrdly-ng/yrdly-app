const fs = require('fs');
const file = '/Users/macbook/Development/projects/yrdly-app/src/components/UserProfileDialog.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "import { MapPin, MessageSquare, UserPlus, Check, X, Clock, MoreHorizontal, ShieldBan, UserMinus } from 'lucide-react';",
  "import { MapPin, MessageSquare, UserPlus, Check, X, Clock, MoreHorizontal, ShieldBan, UserMinus, Star, BadgeCheck } from 'lucide-react';"
);

content = content.replace(
  "import { useFriendshipGlobal } from '@/hooks/use-friendship-global';",
  "import { useFriendshipGlobal } from '@/hooks/use-friendship-global';\nimport { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';"
);

content = content.replace(
  "const [isBlocked, setIsBlocked] = useState(false);",
  "const [isBlocked, setIsBlocked] = useState(false);\n    const [reviews, setReviews] = useState<any[]>([]);"
);

content = content.replace(
  "fetchBlockStatus();",
  "fetchBlockStatus();\n        \n        const fetchReviews = async () => {\n            const { data } = await supabase.from('user_reviews').select('*, buyer:buyer_id(id, name, avatar_url)').eq('seller_id', profileUser.id).order('created_at', { ascending: false });\n            setReviews(data || []);\n        };\n        fetchReviews();"
);

content = content.replace(
  "<h1 className=\"text-2xl font-bold\">{profileUser.name}</h1>",
  "<h1 className=\"text-2xl font-bold flex items-center justify-center gap-1.5\">\n                            {profileUser.name}\n                            {((profileUser as any).is_verified || (profileUser as any).verified_seller || (profileUser as any).phone_verified) && (\n                                <BadgeCheck className={`w-5 h-5 ${(profileUser as any).verified_seller ? 'text-yellow-500 fill-yellow-500/10' : 'text-green-500 fill-green-500/10'}`} />\n                            )}\n                        </h1>"
);

const newCardContent = `
                    <Tabs defaultValue="about" className="w-full">
                        <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="about">About</TabsTrigger>
                            <TabsTrigger value="reviews">Reviews</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="about" className="p-6 space-y-6 max-h-[40vh] overflow-y-auto">
                            <div>
                                <h2 className="font-semibold text-lg mb-2">Bio</h2>
                                <p className="text-muted-foreground">{profileUser.bio || "This user hasn't written a bio yet."}</p>
                            </div>
                            {profileUser.interests && profileUser.interests.length > 0 && (
                                <div>
                                    <h2 className="font-semibold text-lg mb-3">Interests</h2>
                                    <div className="flex flex-wrap gap-2">
                                        {profileUser.interests.map((interest, index) => (
                                            <span key={index} className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full border border-primary/20">
                                                {interest}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                        
                        <TabsContent value="reviews" className="p-4 space-y-4 max-h-[40vh] overflow-y-auto">
                            {reviews.length > 0 ? (
                                reviews.map(review => (
                                    <div key={review.id} className="p-4 rounded-xl bg-card border">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="w-8 h-8">
                                                    <AvatarImage src={review.buyer?.avatar_url} />
                                                    <AvatarFallback>{review.buyer?.name?.charAt(0) || 'U'}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <div className="text-sm font-semibold">{review.buyer?.name || 'Anonymous'}</div>
                                                    <div className="flex items-center text-xs text-muted-foreground">
                                                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 mr-1" />
                                                        {review.rating} / 5
                                                    </div>
                                                </div>
                                            </div>
                                            {review.verified_purchase && (
                                                <div className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                                                    <Check className="w-3 h-3" />
                                                    Verified Purchase
                                                </div>
                                            )}
                                        </div>
                                        {review.comment && (
                                            <p className="text-sm text-foreground/90">{review.comment}</p>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-muted-foreground flex flex-col items-center">
                                    <Star className="w-8 h-8 text-muted-foreground/30 mb-2" />
                                    No reviews yet.
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
`;

content = content.replace(
  /<CardContent className="p-6 space-y-6">([\s\S]*?)<\/CardContent>/,
  newCardContent
);

fs.writeFileSync(file, content);
