export const FIRST_NAMES = [
  'Aaron','Adrian','Alex','Andre','Antoine','Austin','Bailey','Ben','Blake','Brandon','Brent','Brock','Bryce','Caleb',
  'Cam','Carson','Casey','Cedric','Chase','Chris','Cole','Colton','Connor','Corey','Dallas','Damon','Dante','Darius',
  'Darnell','Dashawn','Davis','Dawson','Deandre','Demarco','Derek','Desmond','Devin','Dominic','Donovan','Drew','Dylan',
  'Eli','Elijah','Emmett','Eric','Ethan','Evan','Felix','Gabe','Garrett','Grant','Greg','Hayden','Hunter','Isaiah',
  'Jabari','Jace','Jack','Jalen','Jamal','Jamison','Jaquan','Jared','Jason','Javon','Jaylen','Jermaine','Jesse','Joel',
  'Jordan','Josh','Julian','Justin','Kaden','Kareem','Keenan','Keith','Kendall','Kevin','Khalil','Kyle','Lamar','Lance',
  'Landon','Leon','Logan','Lucas','Luke','Malik','Marcus','Mario','Mason','Mateo','Max','Micah','Miles','Nate','Nick',
  'Noah','Omar','Owen','Parker','Quentin','Quincy','Rashad','Reggie','Rico','Riley','Rodney','Roman','Ryan','Sam',
  'Santiago','Sean','Shane','Silas','Spencer','Stefan','Terrell','Theo','Trent','Trevor','Tristan','Troy','Tyler',
  'Tyrone','Victor','Wade','Wesley','Will','Xavier','Zach','Zion','Kobe','Amari','Bo','Cyrus','Deon','Ezra','Ike',
  'Jonah','Koa','Mekhi','Nico','Rhett','Tate','Vince','Wyatt',
];

export const LAST_NAMES = [
  'Adams','Aldridge','Alvarez','Anderson','Atkins','Bailey','Baker','Banks','Barnes','Bell','Bennett','Blackwell',
  'Boone','Bowers','Boyd','Bradley','Brooks','Bryant','Burke','Butler','Caldwell','Campbell','Carr','Carter','Castillo',
  'Chambers','Chandler','Clark','Cobb','Coleman','Collins','Cook','Cooper','Crawford','Cross','Cruz','Curtis','Daniels',
  'Davenport','Dawson','Dean','Diaz','Dixon','Dorsey','Douglas','Doyle','Drake','Dunn','Edwards','Ellis','Emerson',
  'Evans','Farmer','Fields','Fisher','Fleming','Flowers','Ford','Foster','Fowler','Franklin','Freeman','Fuller','Gaines',
  'Garcia','Gardner','Gibson','Gilbert','Glover','Graham','Grant','Graves','Gray','Greene','Griffin','Hale','Hall',
  'Hamilton','Hammond','Harper','Harris','Hart','Hawkins','Hayes','Henderson','Hicks','Hill','Holland','Holmes',
  'Hopkins','Howard','Hudson','Hughes','Hunt','Ingram','Jackson','James','Jenkins','Jennings','Johnson','Jordan',
  'Keller','Kennedy','Kim','King','Knight','Lambert','Lane','Lawson','Lee','Lewis','Little','Logan','Long','Lopez',
  'Lowe','Mack','Maddox','Malone','Manning','Marsh','Martin','Mason','Maxwell','Mayfield','McBride','McCoy','McDaniel',
  'Meadows','Miles','Miller','Mitchell','Monroe','Moore','Morgan','Morris','Moss','Murphy','Murray','Nash','Nelson',
  'Newton','Nichols','Norris','Oliver','Ortiz','Owens','Palmer','Parker','Patton','Payne','Pearson','Perry','Peters',
  'Phillips','Pierce','Porter','Powell','Price','Pruitt','Quinn','Ramirez','Ramsey','Reed','Reese','Reyes','Rhodes',
  'Rice','Richards','Riley','Rivera','Roberts','Robinson','Rogers','Ross','Russell','Sanders','Santos','Shaw','Shelton',
  'Simmons','Sims','Slater','Small','Spencer','Stanley','Steele','Stephens','Stewart','Stone','Sullivan','Sutton',
  'Tate','Taylor','Terry','Thomas','Thompson','Tillman','Torres','Tucker','Turner','Vance','Vaughn','Wade','Walker',
  'Wallace','Walsh','Ward','Warren','Washington','Waters','Watkins','Watson','Webb','Wells','West','Wheeler','White',
  'Whitfield','Wilkins','Williams','Willis','Wilson','Winston','Wise','Wood','Woods','Wright','Yates','Young','Zeller',
  'Okafor','Nwosu','Tuilagi','Faleolo','Kowalski','Novak','Lindqvist','Moreau','Delgado','Ibarra','Nakamura','Osei',
];

export const COLLEGES = [
  'Lakeshore State','Red Mesa','Pine Valley','Coastal Tech','Northern Plains','Granite U','Bayou State','Sierra Tech',
  'Capital City','Riverbend','Summit State','Prairie A&M','Harbor U','Iron Range','Desert State','Twin Forks',
  'Bluegrass Tech','Cascade U','Gulf Coast','Highland State','Ozark Valley','Tidewater','Badlands U','Magnolia State',
];

// Generated names must never land on a real pro football player's name (first × last combinations can, by chance).
// Stored as FNV-1a hashes of "first last" so the list itself carries no real names; the generator rerolls on a hit.
const BLOCKED = new Set([2974329406,1535842259,4238844761,3334359359,1320744604,1958113380,799684629,1687877201,3909523364,2278440399,2829043671,599799372,2533812334,1244509015,858482969,4094009566,169597460,1759948649,2874859672,2968096789,1729337193,1641042338,2068926996,2818933097,3809850211,339257768,3494189090,2046514694,964702962,3423737877,3057149648,760992152,446571575,2588335688,140824493,2093537333,1616620403,2103319574,1548994732,1238383501,2473989947,3435712892,726065760,95735061,282105772,3176053929,206967431,2728525128,31400529,1583393714,3964353680,3030301899,1494514635,1736995155,3901941116,949687350,2831539129,1570225609,3025726224,1600113048,1114759254,2099128102,3450118359,3752009933,4040846694,3335709944,746110371,3864831091,1747737493,4213821260,616595760,1794808638,349795894,2562761973,1026068020,2805446304,2009472743,4232567195,3304639788,1068642152,2603836126,3648161190,671907714,2100963981,3397096726,637046996,3716750726,2473562141,1082512174,2653643590,6292212,2327988466,2064263316,359312617,3429055319,3523432106,2515276253,3087286149,991365532,3028346919,1476738420,3624972123,316772224,3677879195,1298145402,1870518372,3577455042,2392807987,1529668674,3148675155,4087676535,596431686,409582256,3881203752,3682493335,971504125,1118905403,1714977067,2600264295,3651310208,772100381,1125256751,1785135254,4272016640,2625773222,484648576,1244570046,2962284825,2138124873,412616565,1375749543,4175119258,1772780959,1970058197,4080092395,4149539865,132003008,474838620,1644426435,1230287654,379800911,141837332,4025033586,547191270,412839667,2484366216,1849067132,922306351,538743241,2899184399,713615121,3010424765,3785534856,1372574628,1333847348,1906962866,3413007888,1505807841,655034626,3029069066,4189273119,1160451220,2729976546,3413759412,3927850151,1346479416,790011542,3347095274,1947870121,940056662,3932039561,3636080675,2350705487,1118631331,3663051186,3124627161,3825626973,568773875,1348668797,2342260881,844067189,1766220453,507163509,3230319252,2465972,3163791368,388489106,1707166666,2444308237,2373072982,2639443199,2025656421,2852125427,3878061424,1872753475,3452882627,542348920,1115846317,491855777,2469129392,2870967983,2867944324,936143639,4218811104,3159716888,3888173110,165654490,4205249035,2196967303,1313675502,498683720,1046336902,1820383895,310327655,525411848,184881266,253887513,2491286277,215758321,2242208431,3926596832,3893333425,2204383434,3037475630,1683628934,3317201515,839881699,2835713218,45590304,2722798844,51405396,4065552832,2558939725,2672876270,1253128406,1839142786,2540495104,4000777220,1640747631,1672757041,1046204778,561423840,3420966458,99417138,1844036817,4142713156,728063193,491523763,533514921,1699464228,279658717,1572570423,3122074177,3197959551,1979769630,2606888027,2425811636,4007814159,2725141501,2195471170,1972106579,3489874614,883000631,607760801,2880102840,420169497,1818929350,2050115040,3070497934,4058313189,1104728038,143113194,760513001,352240097,28428808,2312027290,2281031367,2534738343,3160431942,1617386438,4280797754,1289785573,1383581802,4052260720,473943527,1338178716,1895971567,506609206,662702675,1637367765,2222160040,2103093746,596077325,654779611,1190601878,695658355,3160075827,3601356198,707343694,3921563187,997313266,103296140,3079173349,2870001068,133453815,228063802,2782204279,1363998685,1039434911,460892829,2414470007,2275291033,323298753,4143722764,2555021230,2125897939,305763769,1080348864,1484837184,598846238,1610474192,886336118,2204614878,2208444875,3240088740,1458222357,2130203645,456988964,1517230306,3087279441,1118082807,3003553712,3566146597,143645078,3444929829,1512257087,2127295438,2454016822,3852255083,2000841080,2225209817,2890663715,3068302776,375482152,378307047,3794942391,2161716355,2837536354,172843014,4216772234,1428789437,57514969,1006617299,1868043838,2541046618,3751430000,3066560510,1098052911,2895004607,2933717745,1576172839,2276656021,1188200042,1423002445,3027187058,1627152217,1346598120,2398377497]);
export function nameHash(s) { let x = 0x811c9dc5; for (const c of s.toLowerCase()) { x ^= c.charCodeAt(0); x = Math.imul(x, 0x01000193) >>> 0; } return x; }
export const blockedName = (first, last) => BLOCKED.has(nameHash(`${first} ${last}`));
