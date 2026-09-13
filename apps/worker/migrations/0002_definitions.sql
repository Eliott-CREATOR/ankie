-- Adds English definitions to the 50 seed senses (definition_l2 was null after C1 Step 2).
-- Idempotent: matches on lexeme lemma, sets the same value every run.
--
-- One-off repair of the database that existed before data/seed-words.csv carried a
-- definition_l2 column. Not needed on a fresh database — apps/worker/scripts/seed.mjs emits
-- definition_l2 directly now, so every UPDATE below matches zero rows there and is a no-op.

UPDATE senses SET definition_l2 = 'A problem that is difficult to solve because every available option has a serious drawback.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'conundrum');
UPDATE senses SET definition_l2 = 'Found everywhere; so common that you stop noticing it.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'ubiquitous');
UPDATE senses SET definition_l2 = 'Extremely careful about small details, to the point of checking everything.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'meticulous');
UPDATE senses SET definition_l2 = 'Holding two opposing feelings about something at the same time, so unable to decide.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'ambivalent');
UPDATE senses SET definition_l2 = 'A framework of assumptions that shapes how a whole field thinks about its subject.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'paradigm');
UPDATE senses SET definition_l2 = 'The ability to recover quickly after damage or difficulty.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'resilience');
UPDATE senses SET definition_l2 = 'To place two things side by side so the contrast between them becomes visible.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'juxtapose');
UPDATE senses SET definition_l2 = 'Lasting a very short time; gone almost as soon as it appears.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'ephemeral');
UPDATE senses SET definition_l2 = 'Appearing entirely harmless — often used when something turned out not to be.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'innocuous');
UPDATE senses SET definition_l2 = 'Judging by what actually works rather than by theory or principle.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'pragmatic');
UPDATE senses SET definition_l2 = 'Wanting to punish someone who has wronged you, often quietly and over time.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'vindictive');
UPDATE senses SET definition_l2 = 'So complicated and twisted that it becomes hard to follow.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'convoluted');
UPDATE senses SET definition_l2 = 'Stated as the reason, while the real reason is something else.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'ostensible');
UPDATE senses SET definition_l2 = 'A small distinction that changes the meaning, easily missed.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'nuance');
UPDATE senses SET definition_l2 = 'To perceive something that is not obvious, especially by looking carefully.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'discern');
UPDATE senses SET definition_l2 = 'Honest and direct, especially when the truth is uncomfortable.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'candid');
UPDATE senses SET definition_l2 = 'Chosen without a reason that can be defended; it could just as well have been otherwise.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'arbitrary');
UPDATE senses SET definition_l2 = 'Holding together logically, so each part follows from the last.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'coherent');
UPDATE senses SET definition_l2 = 'To draw out a response or reaction that would not have come on its own.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'elicit');
UPDATE senses SET definition_l2 = 'To make an already bad situation worse.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'exacerbate');
UPDATE senses SET definition_l2 = 'Possible to do with the time, money and people actually available.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'feasible');
UPDATE senses SET definition_l2 = 'To slow something down or make it harder, without stopping it entirely.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'hinder');
UPDATE senses SET definition_l2 = 'Certain to happen; impossible to prevent.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'inevitable');
UPDATE senses SET definition_l2 = 'Made of many small parts fitted together with great precision.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'intricate');
UPDATE senses SET definition_l2 = 'Expressed so clearly that a difficult idea becomes easy to follow.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'lucid');
UPDATE senses SET definition_l2 = 'Far smaller than what is needed.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'meager');
UPDATE senses SET definition_l2 = 'An idea or belief, often loosely held rather than carefully worked out.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'notion');
UPDATE senses SET definition_l2 = 'No longer used, because something better has replaced it.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'obsolete');
UPDATE senses SET definition_l2 = 'On the edge of what matters; not central to the main question.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'peripheral');
UPDATE senses SET definition_l2 = 'Believable on the surface, though not necessarily true.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'plausible');
UPDATE senses SET definition_l2 = 'Unstable, and likely to collapse if one thing goes wrong.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'precarious');
UPDATE senses SET definition_l2 = 'Widespread within a particular group or place.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'prevalent');
UPDATE senses SET definition_l2 = 'Given by each side to the other; going both ways.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'reciprocal');
UPDATE senses SET definition_l2 = 'Not needed, because the same thing is already provided elsewhere.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'redundant');
UPDATE senses SET definition_l2 = 'Sharply and plainly obvious, with nothing softening it.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'stark');
UPDATE senses SET definition_l2 = 'So slight that it takes attention to notice, yet it changes things.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'subtle');
UPDATE senses SET definition_l2 = 'Real and concrete enough to be measured or pointed at.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'tangible');
UPDATE senses SET definition_l2 = 'Provisional and not yet confirmed; may still change.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'tentative');
UPDATE senses SET definition_l2 = 'Complete in every detail, leaving nothing unchecked.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'thorough');
UPDATE senses SET definition_l2 = 'Of so little importance that it does not deserve attention.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'trivial');
UPDATE senses SET definition_l2 = 'Never having happened before, so there is nothing to compare it to.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'unprecedented');
UPDATE senses SET definition_l2 = 'Able to work and keep working under real conditions.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'viable');
UPDATE senses SET definition_l2 = 'Changing suddenly and unpredictably, often sharply.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'volatile');
UPDATE senses SET definition_l2 = 'Cautious because you suspect a risk that is not yet proven.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'wary');
UPDATE senses SET definition_l2 = 'Highly skilled at something, especially something difficult.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'adept');
UPDATE senses SET definition_l2 = 'Distant and uninvolved, whether by choice or by appearance.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'aloof');
UPDATE senses SET definition_l2 = 'Open to more than one interpretation, so the intended meaning is unclear.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'ambiguous');
UPDATE senses SET definition_l2 = 'Requiring sustained hard effort over a long period.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'arduous');
UPDATE senses SET definition_l2 = 'So ordinary and predictable that it is dull.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'banal');
UPDATE senses SET definition_l2 = 'The quality of using few words.' WHERE lexeme_id = (SELECT id FROM lexemes WHERE lemma_norm = 'brevity');
