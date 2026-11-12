import { useEffect, useState } from 'react';
import { ArrowRight, Heart, MessageCircle, Plus, Send, Flag, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { getMessage } from '../services/api.js';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView.jsx';

function avatarInitial(user) { return user?.fullName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'D'; }

export default function CommunityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', tags: '' });
  const [busy, setBusy] = useState(false);
  const [commentState, setCommentState] = useState({});

  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/posts', { params: { q: query || undefined, limit: 30 } }); setPosts(data.data); }
    catch (requestError) { setError(getMessage(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [query]);

  async function publish(event) {
    event.preventDefault();
    if (!user) return navigate('/register');
    setBusy(true); setError('');
    try {
      const payload = { ...form, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) };
      const { data } = await api.post('/posts', payload);
      setPosts((current) => [data.data, ...current]); setForm({ title: '', body: '', tags: '' }); setShowComposer(false);
    } catch (requestError) { setError(getMessage(requestError)); }
    finally { setBusy(false); }
  }

  async function toggleLike(post) {
    if (!user) return navigate('/login');
    try {
      const { data } = await api.put(`/posts/${post._id}/like`);
      setPosts((current) => current.map((item) => item._id === post._id ? { ...item, likedByMe: data.data.liked, likeCount: data.data.likeCount } : item));
    } catch (requestError) { setError(getMessage(requestError)); }
  }

  async function loadComments(postId) {
    const current = commentState[postId];
    if (current?.open) return setCommentState((value) => ({ ...value, [postId]: { ...value[postId], open: false } }));
    setCommentState((value) => ({ ...value, [postId]: { ...value[postId], open: true, loading: true } }));
    try {
      const { data } = await api.get(`/posts/${postId}/comments`, { params: { limit: 100 } });
      setCommentState((value) => ({ ...value, [postId]: { ...value[postId], open: true, loading: false, comments: data.data, text: '', parent: '' } }));
    } catch (requestError) { setCommentState((value) => ({ ...value, [postId]: { ...value[postId], open: true, loading: false, error: getMessage(requestError) } })); }
  }

  async function submitComment(event, post) {
    event.preventDefault();
    if (!user) return navigate('/login');
    const state = commentState[post._id];
    try {
      const { data } = await api.post(`/posts/${post._id}/comments`, { body: state.text, parent: state.parent || null });
      setCommentState((value) => ({ ...value, [post._id]: { ...value[post._id], comments: [...(value[post._id].comments || []), data.data], text: '', parent: '' } }));
    } catch (requestError) { setCommentState((value) => ({ ...value, [post._id]: { ...value[post._id], error: getMessage(requestError) } })); }
  }

  async function report(post) {
    if (!user) return navigate('/login');
    const reason = window.prompt('Briefly explain why this post should be reviewed:');
    if (!reason) return;
    try { await api.post('/reports', { targetType: 'Post', target: post._id, reason }); setNotice('Report submitted for review.'); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  async function deletePost(post) {
    if (!window.confirm(`Delete “${post.title}”?`)) return;
    try { await api.delete(`/posts/${post._id}`); setPosts((current) => current.filter((item) => item._id !== post._id)); }
    catch (requestError) { setError(getMessage(requestError)); }
  }

  return <div className="page-stack"><div className="page-heading-row"><div><span className="eyebrow">SHARE WHAT YOU LEARN</span><h1>Developer community</h1><p>Questions, ideas, and practical answers from the people building.</p></div>{user && <button className="button" onClick={() => setShowComposer((value) => !value)}><Plus size={15} /> Start a discussion</button>}</div>
    <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); setQuery(search); }}><MessageCircle size={15} /><input placeholder="Search discussions or topics…" aria-label="Search community" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button button-quiet">Search</button></form>
    {showComposer && <form className="panel post-composer" onSubmit={publish}><div className="panel-heading"><div><span className="eyebrow">START A CONVERSATION</span><h2>New discussion</h2></div><button type="button" className="icon-button" onClick={() => setShowComposer(false)} aria-label="Close"><X size={15} /></button></div><label>Title<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} minLength={5} maxLength={180} required /></label><label>What would you like to share?<textarea rows={5} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} minLength={10} maxLength={10000} required /></label><label>Topics <small>Comma separated</small><input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="react, accessibility, mongodb" /></label>{error && <div className="form-alert form-alert-error">{error}</div>}<div className="form-actions"><button className="button" disabled={busy}>{busy ? 'Publishing…' : 'Publish discussion'} <Send size={14} /></button></div></form>}
    {error && !showComposer && <div className="form-alert form-alert-error" role="alert">{error}</div>}{notice && <div className="form-alert" role="status">{notice}</div>}
    {loading ? <LoadingState label="Loading community…" /> : error && !posts.length ? <ErrorState message={error} onRetry={load} /> : posts.length ? <div className="community-feed">{posts.map((post) => {
      const comments = commentState[post._id] || {};
      return <article className="panel post-card" key={post._id}><div className="post-author-row"><span className="avatar avatar-small">{post.author?.avatarUrl ? <img src={post.author.avatarUrl} alt="" /> : avatarInitial(post.author)}</span><span><strong><Link to={`/developers/${post.author?._id}`}>{post.author?.fullName || post.author?.username}</Link></strong><small>@{post.author?.username} · {new Date(post.createdAt).toLocaleDateString()}</small></span><button className="icon-button post-report" aria-label={`Report ${post.title}`} onClick={() => report(post)}><Flag size={14} /></button>{user && (user.id === String(post.author?._id) || user.role === 'admin') && <button className="icon-button" aria-label={`Delete ${post.title}`} onClick={() => deletePost(post)}><X size={15} /></button>}</div><h2>{post.title}</h2><p className="post-body">{post.body}</p><div className="project-tags">{post.tags?.map((tag) => <button key={tag} onClick={() => { setSearch(tag); setQuery(tag); }}>#{tag}</button>)}</div><div className="post-actions"><button className={post.likedByMe ? 'post-action post-action-active' : 'post-action'} onClick={() => toggleLike(post)}><Heart size={15} fill={post.likedByMe ? 'currentColor' : 'none'} /> {post.likeCount ?? post.likes?.length ?? 0}</button><button className="post-action" onClick={() => loadComments(post._id)}><MessageCircle size={15} /> {comments.comments?.length ?? 'Reply'}</button><Link className="post-action" to={`/community/${post._id}`}>Open thread <ArrowRight size={13} /></Link></div>
        {comments.open && <div className="comments-panel">{comments.loading ? <LoadingState label="Loading replies…" /> : comments.error ? <div className="form-alert form-alert-error">{comments.error}</div> : <div className="comments-list">{comments.comments?.map((comment) => <div className={`comment-row${comment.parent ? ' comment-reply' : ''}`} key={comment._id}><span className="avatar avatar-tiny">{avatarInitial(comment.author)}</span><div><strong>@{comment.author?.username}</strong><p>{comment.body}</p>{user && <button className="reply-link" onClick={() => setCommentState((value) => ({ ...value, [post._id]: { ...value[post._id], parent: comment._id } }))}>Reply</button>}</div></div>)}</div>}{user ? <form className="comment-form" onSubmit={(event) => submitComment(event, post)}><input value={comments.text || ''} onChange={(event) => setCommentState((value) => ({ ...value, [post._id]: { ...value[post._id], text: event.target.value } }))} placeholder={comments.parent ? 'Write a reply…' : 'Add a comment…'} maxLength={4000} required /><button className="icon-button" aria-label="Send comment"><Send size={14} /></button>{comments.parent && <button type="button" className="reply-cancel" onClick={() => setCommentState((value) => ({ ...value, [post._id]: { ...value[post._id], parent: '' } }))}>Cancel reply</button>}</form> : <Link className="comment-login" to="/login">Sign in to join the discussion</Link>}</div>}
      </article>;
    })}</div> : <EmptyState title="No discussions found" description="Be the first to start a conversation, or adjust your search." action={user ? <button className="button" onClick={() => setShowComposer(true)}><Plus size={14} /> Start a discussion</button> : <Link className="button" to="/register">Join the community</Link>} />}
  </div>;
}
