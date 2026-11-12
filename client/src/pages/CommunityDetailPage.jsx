import { useEffect, useState } from 'react';
import { ArrowLeft, Heart, MessageCircle, Send } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

export default function CommunityDetailPage() {
  const { postId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const [postResponse, commentResponse] = await Promise.all([api.get(`/posts/${postId}`), api.get(`/posts/${postId}/comments`, { params: { limit: 100 } })]);
      setPost(postResponse.data.data); setComments(commentResponse.data.data);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [postId]);

  async function like() {
    if (!user) return navigate('/login');
    try { const { data } = await api.put(`/posts/${postId}/like`); setPost((current) => ({ ...current, likedByMe: data.data.liked, likeCount: data.data.likeCount })); }
    catch (requestError) { setError(getMessage(requestError)); }
  }
  async function comment(event) {
    event.preventDefault();
    if (!user) return navigate('/login');
    try { const { data } = await api.post(`/posts/${postId}/comments`, { body: text, parent: reply || null }); setComments((current) => [...current, data.data]); setText(''); setReply(''); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  if (loading) return <main className="public-content page-width"><LoadingState label="Loading discussion…" /></main>;
  if (error || !post) return <main className="public-content page-width"><ErrorState message={error || 'Discussion not found.'} onRetry={load} /></main>;
  return <main className="public-content page-width"><Link className="back-link" to="/community"><ArrowLeft size={14} /> Community</Link><article className="panel post-card post-detail-card"><div className="post-author-row"><span className="avatar avatar-small">{post.author?.avatarUrl ? <img src={post.author.avatarUrl} alt="" /> : post.author?.fullName?.[0]}</span><span><strong><Link to={`/developers/${post.author?._id}`}>{post.author?.fullName}</Link></strong><small>@{post.author?.username} · {new Date(post.createdAt).toLocaleDateString()}</small></span></div><h1>{post.title}</h1><p className="post-body">{post.body}</p><div className="project-tags">{post.tags?.map((tag) => <span key={tag}>#{tag}</span>)}</div><div className="post-actions"><button className={post.likedByMe ? 'post-action post-action-active' : 'post-action'} onClick={like}><Heart size={15} fill={post.likedByMe ? 'currentColor' : 'none'} /> {post.likeCount ?? post.likes?.length ?? 0}</button><span className="post-action"><MessageCircle size={15} /> {comments.length} replies</span></div></article>
    <section className="panel comments-detail"><div className="panel-heading"><div><span className="eyebrow">KEEP IT CONSTRUCTIVE</span><h2>Replies</h2></div></div>{comments.length ? comments.map((item) => <div className={`comment-row${item.parent ? ' comment-reply' : ''}`} key={item._id}><span className="avatar avatar-tiny">{item.author?.fullName?.[0] || 'D'}</span><div><strong>@{item.author?.username}</strong><p>{item.body}</p>{user && <button className="reply-link" onClick={() => setReply(item._id)}>Reply</button>}</div></div>) : <EmptyState title="No replies yet" description="Add a thoughtful response to get the discussion started." />}{user ? <form className="comment-form" onSubmit={comment}><textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} placeholder={reply ? 'Write a reply…' : 'Add a reply…'} required /><button className="button"><Send size={14} /> Post reply</button>{reply && <button type="button" className="button button-quiet" onClick={() => setReply('')}>Cancel reply</button>}</form> : <Link className="button button-quiet" to="/login">Sign in to reply</Link>}</section>
  </main>;
}
