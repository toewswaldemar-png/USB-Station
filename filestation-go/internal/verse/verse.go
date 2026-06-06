package verse

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

type Verse struct {
	Text string `json:"text"`
	Ref  string `json:"ref"`
}

type verseEntry struct {
	book, chapter, verse int
	ref, text            string
}

var verseData = []verseEntry{
	{43, 3, 16, "Joh 3,16", "Denn also hat Gott die Welt geliebt, daß er seinen eingeborenen Sohn gab, damit jeder, der an ihn glaubt, nicht verloren geht, sondern ewiges Leben hat."},
	{50, 4, 4, "Phil 4,4", "Freut euch in dem Herrn allezeit! Wiederum will ich sagen: Freut euch!"},
	{50, 4, 7, "Phil 4,7", "Und der Friede Gottes, der allen Verstand übersteigt, wird eure Herzen und eure Gedanken bewahren in Christus Jesus."},
	{50, 4, 13, "Phil 4,13", "Ich vermag alles durch Christus, der mich stark macht."},
	{19, 23, 1, "Ps 23,1", "Der HERR ist mein Hirte; mir wird nichts mangeln."},
	{19, 46, 2, "Ps 46,2", "Gott ist unsere Zuflucht und Stärke, eine sehr bewährte Hilfe in Nöten."},
	{19, 119, 105, "Ps 119,105", "Dein Wort ist meines Fußes Leuchte und ein Licht auf meinem Weg."},
	{40, 6, 33, "Mt 6,33", "Sucht aber zuerst das Reich Gottes und seine Gerechtigkeit, so wird euch das alles hinzugefügt werden."},
	{40, 28, 20, "Mt 28,20", "Und seht, ich bin bei euch alle Tage bis zur Vollendung des Zeitalters."},
	{45, 8, 28, "Röm 8,28", "Wir wissen aber, daß denen, die Gott lieben, alle Dinge zum Guten mitwirken, denen, die nach dem Vorsatz berufen sind."},
	{49, 2, 8, "Eph 2,8", "Denn aus Gnade seid ihr errettet durch Glauben, und das nicht aus euch – Gottes Gabe ist es."},
	{62, 1, 9, "1Joh 1,9", "Wenn wir unsere Sünden bekennen, so ist er treu und gerecht, daß er uns die Sünden vergibt und uns reinigt von aller Ungerechtigkeit."},
	{62, 4, 8, "1Joh 4,8", "Wer nicht liebt, der hat Gott nicht erkannt; denn Gott ist Liebe."},
	{23, 40, 31, "Jes 40,31", "Aber die auf den HERRN harren, bekommen neue Kraft; sie fahren auf mit Flügeln wie Adler; sie laufen und werden nicht müde, sie gehen und werden nicht matt."},
	{23, 41, 10, "Jes 41,10", "Fürchte dich nicht, denn ich bin bei dir; sei nicht ängstlich, denn ich bin dein Gott! Ich stärke dich, ich helfe dir auch, ich halte dich aufrecht durch die rechte Hand meiner Gerechtigkeit."},
	{24, 29, 11, "Jer 29,11", "Denn ich kenne die Gedanken, die ich über euch habe, spricht der HERR, Gedanken des Friedens und nicht des Unheils, um euch eine Zukunft und eine Hoffnung zu geben."},
	{58, 11, 1, "Hebr 11,1", "Der Glaube aber ist eine Verwirklichung dessen, was man hofft, ein Überzeugtsein von Dingen, die man nicht sieht."},
	{59, 1, 5, "Jak 1,5", "Wenn es aber jemandem unter euch an Weisheit mangelt, so bitte er Gott, der allen willig gibt und keinen Vorwürfe macht, so wird sie ihm gegeben werden."},
	{60, 5, 7, "1Petr 5,7", "Alle eure Sorgen werft auf ihn, denn er sorgt für euch."},
	{42, 1, 37, "Lk 1,37", "Denn bei Gott ist kein Ding unmöglich."},
	{43, 14, 6, "Joh 14,6", "Jesus spricht zu ihm: Ich bin der Weg und die Wahrheit und das Leben; niemand kommt zum Vater als nur durch mich."},
	{43, 14, 27, "Joh 14,27", "Frieden hinterlasse ich euch, meinen Frieden gebe ich euch; nicht wie die Welt gibt, gebe ich euch. Euer Herz erschrecke nicht und verzage nicht."},
	{43, 15, 5, "Joh 15,5", "Ich bin der Weinstock, ihr seid die Reben. Wer in mir bleibt und ich in ihm, der bringt viel Frucht; denn ohne mich könnt ihr nichts tun."},
	{40, 11, 28, "Mt 11,28", "Kommt her zu mir alle, die ihr mühselig und beladen seid, so werde ich euch Ruhe geben."},
	{40, 22, 37, "Mt 22,37", "Du sollst den Herrn, deinen Gott, lieben aus deinem ganzen Herzen und aus deiner ganzen Seele und aus deinem ganzen Verstand."},
	{46, 13, 13, "1Kor 13,13", "Nun aber bleiben Glaube, Hoffnung, Liebe, diese drei; die größte aber von diesen ist die Liebe."},
	{46, 10, 13, "1Kor 10,13", "Euch hat keine Versuchung ergriffen als nur eine menschliche; aber Gott ist treu, der euch nicht über euer Vermögen versuchen lassen wird, sondern mit der Versuchung auch den Ausgang schaffen wird, so daß ihr sie ertragen könnt."},
	{47, 12, 9, "2Kor 12,9", "Meine Gnade ist dir genug; denn meine Kraft wird in der Schwachheit vollbracht."},
	{48, 2, 20, "Gal 2,20", "Ich bin mit Christus gekreuzigt; ich lebe, doch nicht mehr ich, sondern Christus lebt in mir."},
	{48, 5, 22, "Gal 5,22", "Die Frucht des Geistes aber ist: Liebe, Freude, Friede, Langmut, Freundlichkeit, Güte, Treue."},
	{51, 3, 23, "Kol 3,23", "Und alles, was ihr tut, das tut von Herzen als dem Herrn und nicht den Menschen."},
	{55, 1, 7, "2Tim 1,7", "Denn Gott hat uns nicht einen Geist der Furcht gegeben, sondern der Kraft und der Liebe und der Besonnenheit."},
	{19, 1, 1, "Ps 1,1", "Wohl dem Mann, der nicht wandelt im Rat der Gottlosen und nicht auf dem Weg der Sünder steht und nicht im Kreis der Spötter sitzt."},
	{19, 91, 1, "Ps 91,1", "Wer im Schutz des Höchsten wohnt und im Schatten des Allmächtigen bleibt, der spricht zum HERRN: Meine Zuflucht und meine Burg, mein Gott, auf den ich vertraue!"},
	{19, 121, 1, "Ps 121,1", "Ich hebe meine Augen auf zu den Bergen: Woher kommt mir Hilfe? Meine Hilfe kommt vom HERRN, der Himmel und Erde gemacht hat."},
	{19, 34, 8, "Ps 34,8", "Kostet und seht, daß der HERR gütig ist! Wohl dem Menschen, der auf ihn vertraut!"},
	{20, 3, 5, "Spr 3,5", "Vertraue auf den HERRN von ganzem Herzen und stütze dich nicht auf deinen eigenen Verstand!"},
	{20, 3, 6, "Spr 3,6", "In allen deinen Wegen erkenne ihn, so wird er deine Pfade geradelenken."},
	{45, 12, 1, "Röm 12,1", "Ich ermahne euch nun, Brüder, durch die Barmherzigkeit Gottes, eure Leiber als ein lebendiges, heiliges, Gott wohlgefälliges Opfer darzustellen – das ist euer vernünftiger Gottesdienst."},
	{50, 4, 19, "Phil 4,19", "Mein Gott aber wird jede eurer Notlagen ausfüllen nach seinem Reichtum in der Herrlichkeit in Christus Jesus."},
	{62, 4, 19, "1Joh 4,19", "Lasset uns ihn lieben, denn er hat uns zuerst geliebt."},
	{19, 37, 4, "Ps 37,4", "Habe deine Freude an dem HERRN; so wird er dir geben, was dein Herz begehrt."},
	{19, 27, 1, "Ps 27,1", "Der HERR ist mein Licht und mein Heil – vor wem sollte ich mich fürchten? Der HERR ist die Stärke meines Lebens – vor wem sollte mir bangen?"},
	{43, 1, 1, "Joh 1,1", "Im Anfang war das Wort, und das Wort war bei Gott, und das Wort war Gott."},
	{45, 5, 1, "Röm 5,1", "Da wir nun aus Glauben gerechtfertigt worden sind, haben wir Frieden mit Gott durch unseren Herrn Jesus Christus."},
	{66, 21, 5, "Offb 21,5", "Und der auf dem Thron saß, sprach: Seht, ich mache alles neu!"},
	{19, 100, 3, "Ps 100,3", "Erkennt, daß der HERR Gott ist! Er hat uns gemacht und nicht wir selbst; wir sind sein Volk und die Schafe seiner Weide."},
	{20, 16, 3, "Spr 16,3", "Befiehl dem HERRN deine Werke, so werden deine Gedanken zum Ziel kommen."},
	{45, 6, 23, "Röm 6,23", "Denn der Lohn der Sünde ist der Tod; aber die Gnadengabe Gottes ist ewiges Leben in Christus Jesus, unserem Herrn."},
	{43, 8, 36, "Joh 8,36", "Wenn nun der Sohn euch befreit, so seid ihr wirklich frei."},
	{43, 15, 13, "Joh 15,13", "Niemand hat größere Liebe als die, daß er sein Leben für seine Freunde hingibt."},
	{19, 46, 11, "Ps 46,11", "Seid stille und erkennt, daß ich Gott bin! Ich will erhöht werden unter den Heiden, erhöht werden auf der Erde."},
	{40, 5, 8, "Mt 5,8", "Selig sind, die reinen Herzens sind, denn sie werden Gott schauen."},
	{54, 6, 6, "1Tim 6,6", "Aber die Frömmigkeit ist ein großer Gewinn, wenn man sich mit dem Vorhandenen begnügt."},
	{44, 4, 12, "Apg 4,12", "Und in keinem anderen ist das Heil, denn es ist kein anderer Name unter dem Himmel den Menschen gegeben, durch den wir errettet werden sollen."},
	{19, 16, 8, "Ps 16,8", "Ich habe den HERRN beständig vor Augen; weil er zu meiner Rechten ist, werde ich nicht wanken."},
	{20, 4, 23, "Spr 4,23", "Hüte dein Herz mehr als alles, was zu bewahren ist; denn aus ihm quellen die Quellen des Lebens."},
	{51, 1, 17, "Kol 1,17", "Und er ist vor allem, und alles besteht in ihm."},
	{19, 56, 4, "Ps 56,4", "Wenn ich fürchte, auf dich vertraue ich."},
	{45, 15, 13, "Röm 15,13", "Der Gott der Hoffnung aber erfülle euch mit aller Freude und allem Frieden im Glauben, damit ihr reich werdet an Hoffnung durch die Kraft des Heiligen Geistes."},
}

var (
	cache     Verse
	cacheDate string
	cacheMu   sync.Mutex
)

// Get liefert den Tagesvers (HTTP-Fetch mit lokalem Fallback).
func Get() Verse {
	today := time.Now().Format("2006-01-02")

	cacheMu.Lock()
	if cacheDate == today {
		v := cache
		cacheMu.Unlock()
		return v
	}
	cacheMu.Unlock()

	idx := (time.Now().YearDay() - 1) % len(verseData)
	entry := verseData[idx]

	v := fetchOnline(entry.book, entry.chapter, entry.verse)
	if v.Text == "" {
		v = Verse{Text: entry.text, Ref: entry.ref}
	}

	cacheMu.Lock()
	cache = v
	cacheDate = today
	cacheMu.Unlock()
	return v
}

func fetchOnline(book, chapter, verse int) Verse {
	url := fmt.Sprintf("https://getbible.net/v2/schlachter/%d/%d.json", book, chapter)
	client := &http.Client{Timeout: 6 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		slog.Warn("Vers-Fetch fehlgeschlagen", "err", err)
		return Verse{}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return Verse{}
	}

	var data struct {
		Verses map[string]struct {
			Text string `json:"text"`
			Name string `json:"name"`
		} `json:"verses"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return Verse{}
	}

	key := fmt.Sprintf("%d", verse)
	v, ok := data.Verses[key]
	if !ok {
		return Verse{}
	}

	ref := v.Name
	// "43:3:16" → "43,3,16" Normalisierung
	for i := range ref {
		if ref[i] == ':' {
			ref = ref[:i] + "," + ref[i+1:]
		}
	}

	return Verse{Text: v.Text, Ref: ref}
}
