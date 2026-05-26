-- ─────────────────────────────────────────────────────────
-- Fun London — seed data (v1)
-- Run AFTER schema.sql.
-- ─────────────────────────────────────────────────────────

insert into public.places (slug, name, type, vibe, neighbourhood, price, time_of_day, rating, img_url, mood_tags, vibe_tags) values
('dishoom-shoreditch', 'Dishoom Shoreditch', 'Restaurant', 'Bombay café buzzing with spice', 'Shoreditch', '££', 'Evening', 4.7, 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=900&q=80&auto=format&fit=crop', '{dinner}', '{lively}'),
('sager-wilde', 'Sager + Wilde', 'Wine Bar', 'Moody, low-lit, low-intervention wines', 'Shoreditch', '££', 'Night', 4.6, 'https://images.unsplash.com/photo-1516997121675-4c2d1684aa3e?w=900&q=80&auto=format&fit=crop', '{drinks}', '{chill,fancy}'),
('padella', 'Padella', 'Restaurant', 'Hand-rolled pasta, no reservations', 'London Bridge', '££', 'Evening', 4.8, 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=900&q=80&auto=format&fit=crop', '{dinner}', '{lively}'),
('borough-market', 'Borough Market', 'Market', 'A thousand tiny tastings', 'London Bridge', '£', 'Day', 4.7, 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=900&q=80&auto=format&fit=crop', '{activity}', '{lively}'),
('tate-modern', 'Tate Modern', 'Culture', 'Turbine Hall hush', 'Southbank', 'Free', 'Day', 4.6, 'https://images.unsplash.com/photo-1564399579883-451a5d44ec08?w=900&q=80&auto=format&fit=crop', '{culture}', '{chill}'),
('the-french-house', 'The French House', 'Pub', 'No phones, halves only, 80 years of gossip', 'Soho', '££', 'Evening', 4.5, 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=900&q=80&auto=format&fit=crop', '{drinks}', '{chill}'),
('bao-soho', 'Bao Soho', 'Restaurant', 'Pillowy buns, queue out the door', 'Soho', '££', 'Evening', 4.7, 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=900&q=80&auto=format&fit=crop', '{dinner}', '{lively}'),
('hampstead-heath', 'Hampstead Heath', 'Outdoors', 'Wild hills, Parliament skyline', 'Hampstead', 'Free', 'Day', 4.9, 'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=900&q=80&auto=format&fit=crop', '{activity}', '{chill}'),
('ronnie-scotts', 'Ronnie Scott''s', 'Live Music', 'Jazz legends, red velvet', 'Soho', '£££', 'Night', 4.7, 'https://images.unsplash.com/photo-1501612780327-45045538702b?w=900&q=80&auto=format&fit=crop', '{drinks,culture}', '{fancy,lively}'),
('camden-market', 'Camden Market', 'Market', 'Canalside, chaotic, delicious', 'Camden', '£', 'Day', 4.4, 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=900&q=80&auto=format&fit=crop', '{activity}', '{lively}'),
('spiritland', 'Spiritland', 'Listening Bar', 'Audiophile sound, cocktails in amber', 'King''s Cross', '££', 'Night', 4.6, 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80&auto=format&fit=crop', '{drinks}', '{chill,fancy}'),
('barbican-conservatory', 'Barbican Conservatory', 'Culture', 'Brutalist jungle, Sundays only', 'Barbican', 'Free', 'Day', 4.8, 'https://images.unsplash.com/photo-1545569310-1bd9be5ca93b?w=900&q=80&auto=format&fit=crop', '{culture}', '{chill}')
on conflict (slug) do nothing;

insert into public.events (name, venue, area, date_label, time_label, price, category, emoji, img_url) values
('Jazz & Soul Night', 'Ronnie Scott''s', 'Soho', 'Tonight', '8:00 PM', '£25', 'Music', '🎵', 'https://images.unsplash.com/photo-1501612780327-45045538702b?w=900&q=80&auto=format&fit=crop'),
('Street Food Festival', 'Camden Market', 'Camden', 'This Weekend', '12:00 PM', 'Free', 'Food', '🍽️', 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=900&q=80&auto=format&fit=crop'),
('Warehouse Techno Night', 'Fabric', 'Farringdon', 'This Weekend', '11:00 PM', '£20', 'Club', '🎧', 'https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=900&q=80&auto=format&fit=crop'),
('Stand-Up Showcase', 'The Comedy Store', 'Soho', 'Tonight', '9:00 PM', '£15', 'Comedy', '😂', 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=900&q=80&auto=format&fit=crop'),
('Immersive Art: Dreams', '180 The Strand', 'Aldwych', 'This Week', '10:00 AM', '£18', 'Art', '🎨', 'https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=900&q=80&auto=format&fit=crop'),
('Vinyl & Cocktails', 'Spiritland', 'King''s Cross', 'Tonight', '7:00 PM', '£10', 'Music', '🎵', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80&auto=format&fit=crop');
