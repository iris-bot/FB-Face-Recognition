// index.js

var REST_DATA = 'api/faces';

function encodeUriAndQuotes(untrustedStr) {
    return encodeURI(String(untrustedStr)).replace(/'/g, '%27').replace(')', '%29');
}

function loadItems() {
    xhrGet(REST_DATA, function(data) {

        //stop showing loading message
        stopLoadingMessage();

        var receivedItems = data || [];
        var items = [];
        var i;
        // Make sure the received items have correct format
        for (i = 0; i < receivedItems.length; ++i) {
            var item = receivedItems[i];
            if (item && 'id' in item) {
                items.push(item);
            }
        }
        var hasItems = items.length;
        if (!hasItems) {
            items = [];
        }
        for (i = 0; i < items.length; ++i) {
            addItem(items[i], !hasItems);
        }
        if (!hasItems) {
            var table = document.getElementById('notes');
            var nodes = [];
            for (i = 0; i < table.rows.length; ++i) {
                nodes.push(table.rows[i].firstChild.firstChild);
            }
        }
    }, function(err) {
        console.error(err);
    });
}

function setRowContent(item, row) {
    var innerHTML = "<td class='contentName'><div id='nameText' class = 'nameText'>" + item.name + "</div>"+
    "<div id='valText' class = 'valText'>" + 
    (item.value.fbid?"<a href='http://facebook.com/"+item.value.fbid+"' target='_blank'>fbid="+item.value.fbid+"</a>":"") +
	"</div></td><td class='contentDetails'>";

    var attachments = item.attachements;
    if (attachments && attachments.length > 0) {
        innerHTML += "<div class='flexBox'>";
        for (var i = 0; i < attachments.length; ++i) {
            var attachment = attachments[i];

            if (attachment.content_type.indexOf("image/") == 0) {
                innerHTML += "<div class='contentTiles'>" + attachment.key + "<br><img height=\"150\" src=\"" + encodeUriAndQuotes(attachment.url) + "\" onclick='window.open(\"" + encodeUriAndQuotes(attachment.url) + "\")'></img></div>";

            } else if (attachment.content_type.indexOf("audio/") == 0) {
                innerHTML += "<div class='contentTiles'>" + attachment.key + "<br><AUDIO  height=\"50\" src=\"" + encodeUriAndQuotes(attachment.url) + "\" controls></AUDIO></div>";

            } else if (attachment.content_type.indexOf("video/") == 0) {
                innerHTML += "<div class='contentTiles'>" + attachment.key + "<br><VIDEO  height=\"150\" src=\"" + encodeUriAndQuotes(attachment.url) + "\" controls></VIDEO></div>";

            } else if (attachment.content_type.indexOf("text/") == 0 || attachment.content_type.indexOf("application/") == 0) {
                innerHTML += "<div class='contentTiles'><a href=\"" + encodeUriAndQuotes(attachment.url) + "\" target=\"_blank\">" + attachment.key + "</a></div>";
            }

        }
        innerHTML += "</div>";

    }

    row.innerHTML = innerHTML + "</td><td class = 'contentAction'><span class='deleteBtn' onclick='deleteItem(this)' title='delete me'></span></td>";

}

function addItem(item, isNew) {

    var row = document.createElement('tr');
    row.className = "tableRows";
    var id = item && item.id;
    if (id) {
        row.setAttribute('data-id', id);
    }

    if (item){
        setRowContent(item, row);
    }
    
    var table = document.getElementById('notes');
    table.lastChild.appendChild(row);
    row.isNew = !item || isNew;

}

function deleteItem(deleteBtnNode) {
    var row = deleteBtnNode.parentNode.parentNode;
    var attribId = row.getAttribute('data-id');
    if (attribId) {
        xhrDelete(REST_DATA + '?id=' + row.getAttribute('data-id'), function() {
            row.parentNode.removeChild(row);
        }, function(err) {
            console.error(err);
        });
    } else if (attribId == null) {
        row.parentNode.removeChild(row);
    }
}


function showLoadingMessage() {
    document.getElementById('loadingImage').innerHTML = "Loading data " + "<img height=\"100\" width=\"100\" src=\"images/loading.gif\"></img>";
}

function stopLoadingMessage() {
    document.getElementById('loadingImage').innerHTML = "";
}

showLoadingMessage();
loadItems();
